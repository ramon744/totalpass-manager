import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { drainMessageQueue } from "@/lib/services/messages";
import { createSubscription } from "@/lib/services/subscriptions";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { beneficiarioIds, valor, diaVencimento, descricao, nome, telefone } = body;

  type ClienteLote = {
    id: string;
    nome?: string;
    telefone?: string | null;
    valor?: number;
    descricao?: string;
    dataVencimento?: string;
    dependentesCobrancaIds?: string[];
  };

  const clientes = body.clientes as ClienteLote[] | undefined;

  const lista: ClienteLote[] =
    clientes && clientes.length > 0
      ? clientes
      : ((beneficiarioIds as string[] | undefined) ?? []).map((id) => ({
          id,
          nome: nome as string | undefined,
          telefone: telefone as string | null | undefined,
          dependentesCobrancaIds: body.dependentesCobrancaIds as string[] | undefined,
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

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const cliente of lista) {
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
        error: "Valor inválido para este cliente",
      });
      continue;
    }

    if (!clienteDia || clienteDia < 1 || clienteDia > 31) {
      results.push({
        id: cliente.id,
        success: false,
        error: "Data de vencimento inválida para este cliente",
      });
      continue;
    }

    try {
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
      results.push({ id: cliente.id, success: true });
    } catch (e) {
      results.push({
        id: cliente.id,
        success: false,
        error: e instanceof Error ? e.message : "Erro",
      });
    }
  }

  if (results.some((r) => r.success)) {
    try {
      await drainMessageQueue(serviceClient);
    } catch {
      // Assinatura criada; mensagens permanecem na fila para retry manual/cron.
    }
  }

  return NextResponse.json({ results });
}
