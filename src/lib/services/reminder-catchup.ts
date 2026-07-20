import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import { scheduleMessage } from "@/lib/services/messages";
import { getBrazilDateString } from "@/lib/services/reminder-schedule";

const OPEN_STATUS = new Set(["PENDING", "OVERDUE"]);

/** Dias de `from` até `to` (YYYY-MM-DD, fuso Brasília). Positivo = `to` no futuro. */
export function daysBetweenBrazilDates(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T12:00:00-03:00`);
  const to = new Date(`${toYmd}T12:00:00-03:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Define qual lembrete enviar na criação da cobrança quando o cron diário
 * já teria passado ou ainda não se aplica.
 */
export function resolveCatchUpReminderEvent(
  vencimentoYmd: string,
  todayYmd = getBrazilDateString()
): string | null {
  const diffDays = daysBetweenBrazilDates(todayYmd, vencimentoYmd);

  if (diffDays > 3) return null;
  if (diffDays === 3) return "vencimento_3dias";
  if (diffDays === 1 || diffDays === 2) return null;
  if (diffDays === 0) return "vencimento_dia";
  if (diffDays === -1) return "vencimento_1dia";
  // Sem vencimento_7dias: a partir da carência entra o aviso de desvínculo.
  return null;
}

function formatVencimentoBr(vencimentoYmd: string) {
  return vencimentoYmd.split("-").reverse().join("/");
}

function formatValor(valor: number | string) {
  return Number(valor).toFixed(2).replace(".", ",");
}

/** Agenda lembrete de catch-up ao criar cobrança (se aplicável). */
export async function scheduleCatchUpPaymentReminder(
  supabase: SupabaseClient,
  params: {
    beneficiarioId: string;
    vencimento: string;
    valor: number | string;
    status: string;
    asaasPaymentId?: string | null;
    nome?: string;
  }
) {
  if (!OPEN_STATUS.has(params.status)) return;
  if (!params.asaasPaymentId) return;

  const evento = resolveCatchUpReminderEvent(params.vencimento);
  if (!evento) return;

  const { data: template } = await supabase
    .from("mensagem_templates")
    .select("id")
    .eq("evento", evento)
    .eq("ativo", true)
    .maybeSingle();
  if (!template?.id) return;

  const baseVars = {
    nome: params.nome ?? "",
    valor: formatValor(params.valor),
    data_vencimento: formatVencimentoBr(params.vencimento),
  };

  const vars = await buildPaymentTemplateVars(
    supabase,
    params.asaasPaymentId,
    baseVars
  );

  await scheduleMessage(supabase, {
    evento,
    beneficiarioId: params.beneficiarioId,
    vars,
    agendadoPara: new Date(),
    asaasPaymentId: params.asaasPaymentId,
  });
}

/** Remove lembretes pendentes vinculados a cobranças canceladas. */
export async function cancelPendingMessagesForPayments(
  supabase: SupabaseClient,
  asaasPaymentIds: string[]
) {
  const ids = asaasPaymentIds.filter(Boolean);
  if (!ids.length) return;

  for (const paymentId of ids) {
    await supabase
      .from("mensagens")
      .delete()
      .eq("status", "pendente")
      .eq("payload_envio->>ref_id", paymentId);
  }
}
