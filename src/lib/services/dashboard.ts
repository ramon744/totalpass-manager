import type { SupabaseClient } from "@supabase/supabase-js";
import { mapAsaasPaymentStatus } from "@/lib/asaas/client";
import { buildBeneficiarioResumo } from "@/lib/beneficiarios-resumo";
import { createLog } from "@/lib/logger";
import { drainMessageQueue, scheduleMessage } from "@/lib/services/messages";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import { scheduleCatchUpPaymentReminder } from "@/lib/services/reminder-catchup";
import { handleAsaasSubscriptionWebhook } from "@/lib/services/subscriptions";
import type { DashboardStats, ProvedorResumo } from "@/types/database";

const SEM_PROVEDOR_ID = "__sem_provedor__";

function buildProvedoresResumo(
  beneficiarios: {
    perfil: string;
    status_totalpass: string;
    provedor_id: string | null;
  }[],
  provedores: { id: string; nome: string }[]
): ProvedorResumo[] {
  const nomeById = new Map(provedores.map((p) => [p.id, p.nome]));
  const acc = new Map<string, ProvedorResumo>();

  const getBucket = (id: string, nome: string) => {
    let bucket = acc.get(id);
    if (!bucket) {
      bucket = {
        id,
        nome,
        ativos: 0,
        elegiveis: 0,
        inativos: 0,
        titularesAtivos: 0,
        titularesElegiveis: 0,
        dependentesAtivos: 0,
        dependentesElegiveis: 0,
        total: 0,
        totalGeral: 0,
      };
      acc.set(id, bucket);
    }
    return bucket;
  };

  for (const b of beneficiarios) {
    const id = b.provedor_id ?? SEM_PROVEDOR_ID;
    const nome =
      b.provedor_id == null
        ? "Sem provedor"
        : nomeById.get(b.provedor_id) ?? "Provedor removido";
    const bucket = getBucket(id, nome);

    const inativo = b.status_totalpass === "inativo";

    if (b.status_totalpass === "ativo") bucket.ativos++;
    else if (b.status_totalpass === "elegivel") bucket.elegiveis++;
    else if (inativo) bucket.inativos++;

    // Titulares/Dependentes por status (sem inativos), alinhado ao TotalPass.
    if (!inativo) {
      if (b.perfil === "titular") {
        if (b.status_totalpass === "ativo") bucket.titularesAtivos++;
        else if (b.status_totalpass === "elegivel") bucket.titularesElegiveis++;
      } else if (b.perfil === "dependente") {
        if (b.status_totalpass === "ativo") bucket.dependentesAtivos++;
        else if (b.status_totalpass === "elegivel") bucket.dependentesElegiveis++;
      }
      bucket.total++;
    }

    bucket.totalGeral++;
  }

  return Array.from(acc.values()).sort((a, b) => {
    if (a.id === SEM_PROVEDOR_ID) return 1;
    if (b.id === SEM_PROVEDOR_ID) return -1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function isCobrancaVencida(c: { status: string; vencimento: string }) {
  const hoje = new Date().toISOString().split("T")[0];
  return (
    c.status === "OVERDUE" ||
    (c.status === "PENDING" && c.vencimento < hoje)
  );
}

export async function getDashboardStats(
  supabase: SupabaseClient
): Promise<DashboardStats> {
  const [
    { data: beneficiarios },
    { data: provedores },
    { count: assinaturasAtivas },
    { count: cobrancasPendentes },
    { data: cobrancas },
  ] = await Promise.all([
    supabase.from("beneficiarios").select("perfil, status_totalpass, provedor_id"),
    supabase.from("provedores").select("id, nome"),
    supabase
      .from("assinaturas")
      .select("*", { count: "exact", head: true })
      .eq("status", "ACTIVE"),
    supabase
      .from("cobrancas")
      .select("*", { count: "exact", head: true })
      .eq("status", "PENDING"),
    supabase.from("cobrancas").select("valor, status, vencimento"),
  ]);

  const lista = beneficiarios ?? [];
  const titulares = buildBeneficiarioResumo(
    lista.filter((b) => b.perfil === "titular")
  );
  const dependentes = buildBeneficiarioResumo(
    lista.filter((b) => b.perfil === "dependente")
  );
  const provedoresResumo = buildProvedoresResumo(lista, provedores ?? []);

  const receitaRecebida =
    cobrancas
      ?.filter((c) => ["RECEIVED", "CONFIRMED"].includes(c.status))
      .reduce((s, c) => s + Number(c.valor), 0) ?? 0;

  const receitaPrevista =
    cobrancas
      ?.filter((c) => ["PENDING", "OVERDUE", "CONFIRMED", "RECEIVED"].includes(c.status))
      .reduce((s, c) => s + Number(c.valor), 0) ?? 0;

  const emVencidas =
    cobrancas
      ?.filter((c) => isCobrancaVencida(c))
      .reduce((s, c) => s + Number(c.valor), 0) ?? 0;

  const cobrancasVencidas =
    cobrancas?.filter((c) => isCobrancaVencida(c)).length ?? 0;

  // Inadimplência = apenas cobranças realmente vencidas (não pendentes futuras).
  const inadimplencia =
    receitaPrevista > 0 ? (emVencidas / receitaPrevista) * 100 : 0;

  return {
    totalBeneficiarios: lista.length,
    titulares,
    dependentes,
    provedores: provedoresResumo,
    assinaturasAtivas: assinaturasAtivas ?? 0,
    cobrancasPendentes: cobrancasPendentes ?? 0,
    cobrancasVencidas: cobrancasVencidas ?? 0,
    receitaPrevista,
    receitaRecebida,
    inadimplencia,
  };
}

export async function handleAsaasWebhook(
  supabase: SupabaseClient,
  event: string,
  payment?: {
    id: string;
    customer: string;
    subscription?: string;
    value: number;
    dueDate: string;
    paymentDate?: string;
    status: string;
    invoiceUrl?: string;
    bankSlipUrl?: string;
    identificationField?: string;
  },
  subscription?: { id: string; status: string; customer: string }
) {
  if (payment) {
    const status = mapAsaasPaymentStatus(payment.status);
    const { data: beneficiario } = await supabase
      .from("beneficiarios")
      .select("id, nome")
      .eq("asaas_customer_id", payment.customer)
      .maybeSingle();

    if (!beneficiario) return;

    let assinaturaId: string | null = null;
    if (payment.subscription) {
      const { data: assinatura } = await supabase
        .from("assinaturas")
        .select("id")
        .eq("asaas_subscription_id", payment.subscription)
        .maybeSingle();
      assinaturaId = assinatura?.id ?? null;
    }

    const { data: existing } = await supabase
      .from("cobrancas")
      .select("id")
      .eq("asaas_payment_id", payment.id)
      .maybeSingle();

    const payload = {
      beneficiario_id: beneficiario.id,
      assinatura_id: assinaturaId,
      valor: payment.value,
      vencimento: payment.dueDate,
      data_pagamento: payment.paymentDate ?? null,
      status,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from("cobrancas").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("cobrancas").insert({
        ...payload,
        asaas_payment_id: payment.id,
      });

      if (status === "PENDING" || status === "OVERDUE") {
        await scheduleCatchUpPaymentReminder(supabase, {
          beneficiarioId: beneficiario.id,
          vencimento: payment.dueDate,
          valor: payment.value,
          status,
          asaasPaymentId: payment.id,
          nome: beneficiario.nome,
        });
      }
    }

    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      await scheduleMessage(supabase, {
        evento: "pagamento_confirmado",
        beneficiarioId: beneficiario.id,
        vars: {
          nome: beneficiario.nome,
          valor: payment.value.toFixed(2).replace(".", ","),
        },
      });
    }

    if (event === "PAYMENT_OVERDUE") {
      await createLog(supabase, {
        acao: "cobranca_vencida",
        entidade: "cobrancas",
        payload: { payment_id: payment.id },
      });
    }

    if (event === "PAYMENT_CREATED" || event === "PAYMENT_PENDING") {
      const baseVars = {
        nome: beneficiario.nome,
        valor: payment.value.toFixed(2).replace(".", ","),
        data_vencimento: payment.dueDate.split("-").reverse().join("/"),
      };
      const vars = await buildPaymentTemplateVars(supabase, payment.id, baseVars, {
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        identificationField: payment.identificationField,
      });

      await scheduleMessage(supabase, {
        evento: "cobranca_gerada",
        beneficiarioId: beneficiario.id,
        vars,
        asaasPaymentId: payment.id,
      });
    }
  }

  if (subscription) {
    await handleAsaasSubscriptionWebhook(supabase, event, subscription);
  }

  await createLog(supabase, {
    acao: `webhook_${event}`,
    entidade: "asaas",
    payload: { payment, subscription },
  });

  try {
    await drainMessageQueue(supabase);
  } catch {
    // Mensagens permanecem na fila para retry manual/cron.
  }
}
