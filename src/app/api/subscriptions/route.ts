import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { drainMessageQueue } from "@/lib/services/messages";
import { createSubscription } from "@/lib/services/subscriptions";
import { enqueueInfinityJob } from "@/lib/services/infinity-jobs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { beneficiarioIds, valor, diaVencimento, descricao, nome, telefone } =
    body;

  type ClienteLote = {
    id: string;
    nome?: string;
    telefone?: string | null;
    valor?: number;
    descricao?: string;
    dataVencimento?: string;
    dependentesCobrancaIds?: string[];
    gateway?: "asaas" | "infinity";
  };

  const clientes = body.clientes as ClienteLote[] | undefined;

  const lista: ClienteLote[] =
    clientes && clientes.length > 0
      ? clientes
      : ((beneficiarioIds as string[] | undefined) ?? []).map((id) => ({
          id,
          nome: nome as string | undefined,
          telefone: telefone as string | null | undefined,
          dependentesCobrancaIds: body.dependentesCobrancaIds as
            | string[]
            | undefined,
          gateway: "asaas" as const,
        }));

  if (!lista.length) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const usaValorPorCliente = lista.every(
    (c) => c.valor != null && Number(c.valor) > 0
  );
  if (!usaValorPorCliente && !valor) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const usaVencimentoPorCliente = lista.every((c) => Boolean(c.dataVencimento));
  if (!usaVencimentoPorCliente && !diaVencimento) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  const results: Array<{
    id: string;
    success: boolean;
    gateway?: "asaas" | "infinity";
    error?: string;
    enqueued?: boolean;
  }> = [];

  let asaasSuccess = false;

  for (const cliente of lista) {
    const gateway = cliente.gateway === "infinity" ? "infinity" : "asaas";
    const clienteValor =
      cliente.valor != null ? Number(cliente.valor) : Number(valor);
    const clienteDescricao =
      cliente.descricao?.trim() || descricao || "Mensalidade TotalPass";
    const clienteDia = cliente.dataVencimento
      ? Number(cliente.dataVencimento.split("-")[2])
      : Number(diaVencimento);

    if (!clienteValor || clienteValor <= 0) {
      results.push({
        id: cliente.id,
        success: false,
        gateway,
        error: "Valor inválido para este cliente",
      });
      continue;
    }

    if (!clienteDia || clienteDia < 1 || clienteDia > 31) {
      results.push({
        id: cliente.id,
        success: false,
        gateway,
        error: "Data de vencimento inválida para este cliente",
      });
      continue;
    }

    try {
      if (gateway === "infinity") {
        // Enfileira create_charge; gateway Infinity só é marcado no SUCCEEDED.
        // Assim, se falhar, o cliente continua no Financeiro.
        const { data: ben, error: benErr } = await serviceClient
          .from("beneficiarios")
          .select(
            "id, perfil, gateway_pagamento, telefone, nome, email, cpf, infinity_customer_id"
          )
          .eq("id", cliente.id)
          .maybeSingle();
        if (benErr || !ben) {
          throw new Error(benErr?.message ?? "Beneficiário não encontrado");
        }
        if (ben.perfil !== "titular") {
          throw new Error("Só titulares podem ir para Infinity");
        }
        if (ben.infinity_customer_id) {
          throw new Error(
            "Cliente já tem ID Infinity — confira Cobranças Infinity ou sincronize"
          );
        }

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { updated_at: now };
        if (cliente.nome?.trim()) patch.nome = cliente.nome.trim();
        if (cliente.telefone) patch.telefone = String(cliente.telefone);
        if (Object.keys(patch).length > 1) {
          const { error: upErr } = await serviceClient
            .from("beneficiarios")
            .update(patch)
            .eq("id", cliente.id);
          if (upErr) throw new Error(upErr.message);
        }

        await enqueueInfinityJob(serviceClient, {
          tipo: "create_charge",
          beneficiarioId: cliente.id,
          payload: {
            valor: clienteValor,
            descricao: clienteDescricao,
            dataVencimento: cliente.dataVencimento ?? null,
            telefone: cliente.telefone || ben.telefone,
            email: ben.email,
            nome: cliente.nome || ben.nome,
            cpf: ben.cpf,
            origem: "financeiro",
          },
          userId: user.id,
        });

        results.push({
          id: cliente.id,
          success: true,
          gateway: "infinity",
          enqueued: true,
        });
        continue;
      }

      // Segurança: não criar Asaas se já tem cliente Infinity real.
      // Limbo (gateway infinity sem id) pode gerar Asaas ou reenfileirar Infinity.
      const { data: check } = await serviceClient
        .from("beneficiarios")
        .select("gateway_pagamento, infinity_customer_id")
        .eq("id", cliente.id)
        .maybeSingle();
      if (check?.infinity_customer_id) {
        throw new Error(
          "Cliente já está no gateway Infinity — não gere fatura Asaas"
        );
      }
      const { data: jobAberto } = await serviceClient
        .from("infinity_jobs")
        .select("id, status")
        .eq("beneficiario_id", cliente.id)
        .eq("tipo", "create_charge")
        .in("status", ["pending", "claimed", "running"])
        .limit(1)
        .maybeSingle();
      if (jobAberto) {
        throw new Error(
          "Já existe criação Infinity na fila para este cliente — aguarde a extensão"
        );
      }

      await createSubscription(serviceClient, {
        beneficiarioId: cliente.id,
        valor: clienteValor,
        diaVencimento: clienteDia,
        nextDueDate: cliente.dataVencimento,
        descricao: clienteDescricao,
        nome: cliente.nome,
        telefone: cliente.telefone,
        dependentesCobrancaIds: cliente.dependentesCobrancaIds,
        userId: user.id,
      });
      results.push({ id: cliente.id, success: true, gateway: "asaas" });
      asaasSuccess = true;
    } catch (e) {
      results.push({
        id: cliente.id,
        success: false,
        gateway,
        error: e instanceof Error ? e.message : "Erro",
      });
    }
  }

  // Só drena fila WhatsApp se houve criação Asaas (Infinity não notifica aqui)
  if (asaasSuccess) {
    try {
      await drainMessageQueue(serviceClient);
    } catch {
      // Assinatura criada; mensagens permanecem na fila
    }
  }

  return NextResponse.json({ results });
}
