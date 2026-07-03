import type { SupabaseClient } from "@supabase/supabase-js";
import { AsaasClient, mapAsaasPaymentStatus } from "@/lib/asaas/client";
import { getAsaasConfig } from "@/lib/config";
import { wasRecentlyUpdated } from "@/lib/sync-grace";
import { drainMessageQueue, scheduleMessage } from "@/lib/services/messages";
import {
  cancelPendingMessagesForPayments,
  scheduleCatchUpPaymentReminder,
} from "@/lib/services/reminder-catchup";

const PAID_STATUS = new Set(["RECEIVED", "CONFIRMED"]);
const OPEN_STATUS = new Set(["PENDING", "OVERDUE"]);

/** Cancela cobranças abertas no banco e no Asaas. */
export async function cancelOpenCobrancasForBeneficiario(
  supabase: SupabaseClient,
  beneficiarioId: string,
  options?: { asaas?: AsaasClient | null; assinaturaId?: string }
) {
  let asaas = options?.asaas;
  if (asaas === undefined) {
    const asaasConfig = await getAsaasConfig(supabase);
    asaas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;
  }

  let query = supabase
    .from("cobrancas")
    .select("id, asaas_payment_id")
    .eq("beneficiario_id", beneficiarioId)
    .in("status", ["PENDING", "OVERDUE"]);

  if (options?.assinaturaId) {
    query = query.eq("assinatura_id", options.assinaturaId);
  }

  const { data: cobrancas } = await query;
  const ids = (cobrancas ?? []).map((c) => c.id);
  if (!ids.length) return { cancelled: 0 };

  if (asaas) {
    for (const cobranca of cobrancas ?? []) {
      if (!cobranca.asaas_payment_id) continue;
      try {
        await asaas.deletePayment(cobranca.asaas_payment_id);
      } catch {
        // Continua mesmo se o Asaas falhar.
      }
    }
  }

  const paymentIds = (cobrancas ?? [])
    .map((c) => c.asaas_payment_id)
    .filter((id): id is string => Boolean(id));
  await cancelPendingMessagesForPayments(supabase, paymentIds);

  await supabase
    .from("cobrancas")
    .update({
      status: "DELETED",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  return { cancelled: ids.length };
}

/**
 * Corrige cobranças abertas cuja assinatura já foi cancelada (dados legados).
 */
export async function reconcileCobrancasAssinaturaCancelada(
  supabase: SupabaseClient
) {
  const { data: cobrancas } = await supabase
    .from("cobrancas")
    .select("id, beneficiario_id, assinatura_id, asaas_payment_id, assinatura:assinaturas(status)")
    .in("status", ["PENDING", "OVERDUE"])
    .not("assinatura_id", "is", null);

  const orfas = (cobrancas ?? []).filter((c) => {
    const assinatura = Array.isArray(c.assinatura) ? c.assinatura[0] : c.assinatura;
    return assinatura?.status === "CANCELLED";
  });

  if (!orfas.length) return { fixed: 0 };

  const asaasConfig = await getAsaasConfig(supabase);
  const asaas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;

  if (asaas) {
    for (const cobranca of orfas) {
      if (!cobranca.asaas_payment_id) continue;
      try {
        await asaas.deletePayment(cobranca.asaas_payment_id);
      } catch {
        // Continua mesmo se o Asaas falhar.
      }
    }
  }

  await supabase
    .from("cobrancas")
    .update({
      status: "DELETED",
      updated_at: new Date().toISOString(),
    })
    .in(
      "id",
      orfas.map((c) => c.id)
    );

  return { fixed: orfas.length };
}

/** Janela para notificar pagamentos recém-descobertos como pagos (evita avisar histórico antigo). */
const NOTIFY_RECENT_PAYMENT_MS = 2 * 24 * 60 * 60 * 1000;

function toIso(date?: string | null) {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatValor(value: number | string) {
  return Number(value).toFixed(2).replace(".", ",");
}

/**
 * Sincroniza as cobranças do Asaas para a tabela local (modelo pull), garantindo
 * que a aba de cobranças mostre tudo mesmo quando o webhook não é entregue.
 * Notifica o beneficiário quando uma cobrança passa de aberta para paga.
 */
export async function syncCobrancasFromAsaas(supabase: SupabaseClient) {
  const asaasConfig = await getAsaasConfig(supabase);
  if (!asaasConfig?.api_key) return { synced: 0 };

  const asaas = new AsaasClient(asaasConfig);

  const { data: beneficiarios } = await supabase
    .from("beneficiarios")
    .select("id, nome, asaas_customer_id")
    .not("asaas_customer_id", "is", null);

  const benByCustomer = new Map<string, { id: string; nome: string }>();
  for (const b of beneficiarios ?? []) {
    if (b.asaas_customer_id) {
      benByCustomer.set(b.asaas_customer_id, { id: b.id, nome: b.nome });
    }
  }

  if (benByCustomer.size === 0) return { synced: 0 };

  const { data: assinaturas } = await supabase
    .from("assinaturas")
    .select("id, asaas_subscription_id");

  const subById = new Map<string, string>();
  for (const a of assinaturas ?? []) {
    if (a.asaas_subscription_id) subById.set(a.asaas_subscription_id, a.id);
  }

  let offset = 0;
  const limit = 100;
  let synced = 0;
  let guard = 0;

  while (guard++ < 50) {
    let page;
    try {
      page = await asaas.listPayments({ offset, limit });
    } catch {
      break;
    }

    for (const p of page.data ?? []) {
      const ben = benByCustomer.get(p.customer);
      if (!ben) continue;

      const status = mapAsaasPaymentStatus(p.status);
      const assinaturaId = p.subscription
        ? subById.get(p.subscription) ?? null
        : null;
      const dataPagamento = toIso(p.paymentDate ?? p.clientPaymentDate);

      const { data: existing } = await supabase
        .from("cobrancas")
        .select("id, status, valor, vencimento, data_pagamento, assinatura_id, updated_at")
        .eq("asaas_payment_id", p.id)
        .maybeSingle();

      const preserveLocalFields = wasRecentlyUpdated(existing?.updated_at);
      const payload = {
        beneficiario_id: ben.id,
        assinatura_id: assinaturaId,
        valor: preserveLocalFields && existing ? existing.valor : p.value,
        vencimento: preserveLocalFields && existing ? existing.vencimento : p.dueDate,
        data_pagamento: dataPagamento,
        status,
        updated_at: new Date().toISOString(),
      };

      if (!existing) {
        await supabase
          .from("cobrancas")
          .insert({ ...payload, asaas_payment_id: p.id });
        synced++;

        const recemPago =
          PAID_STATUS.has(status) &&
          dataPagamento != null &&
          Date.now() - new Date(dataPagamento).getTime() <=
            NOTIFY_RECENT_PAYMENT_MS;

        if (recemPago) {
          await scheduleMessage(supabase, {
            evento: "pagamento_confirmado",
            beneficiarioId: ben.id,
            vars: { nome: ben.nome, valor: formatValor(p.value) },
          });
        } else if (OPEN_STATUS.has(status)) {
          await scheduleCatchUpPaymentReminder(supabase, {
            beneficiarioId: ben.id,
            vencimento: p.dueDate,
            valor: p.value,
            status,
            asaasPaymentId: p.id,
            nome: ben.nome,
          });
        }
      } else {
        // Só atualiza quando algo realmente mudou, evitando escrever updated_at
        // à toa (o que dispararia o realtime e causaria refresh em loop).
        const mesmaData =
          toIso(existing.data_pagamento) === dataPagamento;
        const mudou = preserveLocalFields
          ? existing.status !== status ||
            !mesmaData ||
            (existing.assinatura_id ?? null) !== assinaturaId
          : existing.status !== status ||
            Number(existing.valor) !== Number(p.value) ||
            existing.vencimento !== p.dueDate ||
            !mesmaData ||
            (existing.assinatura_id ?? null) !== assinaturaId;

        if (mudou) {
          await supabase.from("cobrancas").update(payload).eq("id", existing.id);
          synced++;
        }

        if (OPEN_STATUS.has(existing.status) && PAID_STATUS.has(status)) {
          await scheduleMessage(supabase, {
            evento: "pagamento_confirmado",
            beneficiarioId: ben.id,
            vars: { nome: ben.nome, valor: formatValor(p.value) },
          });
        }
      }
    }

    if (!page.hasMore) break;
    offset += limit;
  }

  if (synced > 0) {
    try {
      await drainMessageQueue(supabase);
    } catch {
      // Mensagens permanecem na fila para retry manual/cron.
    }
  }

  return { synced };
}
