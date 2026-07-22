import type { SupabaseClient } from "@supabase/supabase-js";
import { getUazapiConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import { UazapiClient, renderTemplate } from "@/lib/uazapi/client";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import { resolveBeneficioFornecido } from "@/lib/services/provedor-vars";
import {
  computeReminderScheduleSlots,
  getBrazilDateString,
  resolveSendIntervalMs,
} from "@/lib/services/reminder-schedule";
import type { ReminderWindowOptions } from "@/lib/services/reminder-schedule";
import { getCronConfig, getReminderWindow } from "@/lib/cron-config";
import {
  alertAdminIfUazapiOffline,
  markUazapiOnline,
} from "@/lib/services/uazapi-health";
import { normalizePhone } from "@/lib/utils";
import type { Mensagem, TipoEnvioMensagem } from "@/types/database";

/** Intervalo entre envios em lote para reduzir risco de bloqueio no WhatsApp. */
const MESSAGE_SEND_INTERVAL_MS = 3_000;
/** Máximo de mensagens processadas por rodada da fila. */
const MESSAGE_QUEUE_BATCH_LIMIT = 10;
/** Janela anti-duplicidade: não reagenda a mesma mensagem dentro deste período. */
const MESSAGE_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asStringPayload(
  vars: Record<string, string | number>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, String(value ?? "")])
  );
}

function nextRetryDate(attempt: number, intervals: number[] | null | undefined) {
  const minutes = intervals?.[attempt - 1] ?? intervals?.at(-1) ?? 10;
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
}

async function sendQueuedMessage(client: UazapiClient, msg: Mensagem) {
  const payload = (msg.payload_envio ?? {}) as Record<string, string>;

  if (msg.tipo_envio === "botao_pix") {
    if (!payload.codigo_pix) throw new Error("Código PIX ausente para botão");
    await client.sendCopyButton(msg.telefone, msg.mensagem, payload.codigo_pix ?? "");
    return;
  }

  if (msg.tipo_envio === "botoes_pix_boleto") {
    if (!payload.codigo_pix || !payload.linha_digitavel) {
      throw new Error("PIX ou linha digitável ausente para botões");
    }
    await client.sendPaymentCopyButtons(msg.telefone, msg.mensagem, {
      codigoPix: payload.codigo_pix ?? "",
      linhaDigitavel: payload.linha_digitavel ?? "",
    });
    return;
  }

  if (msg.tipo_envio === "botoes_pagamento") {
    if (!payload.codigo_pix || !payload.linha_digitavel || !payload.link_fatura) {
      throw new Error("PIX, linha digitável ou link da fatura ausente para botões");
    }
    await client.sendPaymentActionButtons(msg.telefone, msg.mensagem, {
      codigoPix: payload.codigo_pix ?? "",
      linhaDigitavel: payload.linha_digitavel ?? "",
      linkFatura: payload.link_fatura ?? "",
    });
    return;
  }

  if (msg.tipo_envio === "botao_link") {
    const link =
      (payload.link_pagamento || payload.link_fatura || "").trim();
    if (!link) {
      await client.sendText(msg.telefone, msg.mensagem);
      return;
    }
    await client.sendLinkButton(msg.telefone, msg.mensagem, link);
    return;
  }

  await client.sendText(msg.telefone, msg.mensagem);
}

export async function scheduleMessage(
  supabase: SupabaseClient,
  params: {
    evento: string;
    beneficiarioId: string;
    vars: Record<string, string | number>;
    agendadoPara?: Date;
    /** ID do pagamento Asaas — dedupe por cobrança (permite reenvio após cancelar/recriar). */
    asaasPaymentId?: string | null;
    /** Referência alternativa (ex.: assinatura Asaas) quando ainda não há payment id. */
    refId?: string | null;
  }
) {
  const { data: template } = await supabase
    .from("mensagem_templates")
    .select("*")
    .eq("evento", params.evento)
    .eq("ativo", true)
    .maybeSingle();

  if (!template) return;

  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("telefone, nome")
    .eq("id", params.beneficiarioId)
    .single();

  if (!beneficiario?.telefone) return;

  const beneficioFornecido = await resolveBeneficioFornecido(
    supabase,
    params.beneficiarioId
  );

  const vars = {
    nome: beneficiario.nome,
    beneficio_fornecido: beneficioFornecido,
    ...params.vars,
  };
  const mensagem = renderTemplate(template.corpo, vars);
  const dedupeRef = params.asaasPaymentId ?? params.refId ?? null;
  const payloadEnvio: Record<string, string> = {
    ...asStringPayload(vars),
    ...(dedupeRef ? { ref_id: dedupeRef } : {}),
  };
  let tipoEnvio = (template.tipo_envio ?? "texto") as TipoEnvioMensagem;
  if (tipoEnvio === "botao_link") {
    const link = String(
      payloadEnvio.link_pagamento || payloadEnvio.link_fatura || ""
    ).trim();
    if (!link) tipoEnvio = "texto";
  }

  if (dedupeRef) {
    const { data: jaExiste } = await supabase
      .from("mensagens")
      .select("id")
      .eq("beneficiario_id", params.beneficiarioId)
      .eq("template_id", template.id)
      .eq("payload_envio->>ref_id", dedupeRef)
      .in("status", ["pendente", "enviando", "enviado"])
      .limit(1)
      .maybeSingle();
    if (jaExiste) return;
  } else {
    // Anti-duplicidade genérica: mesma mensagem recente sem ref de cobrança.
    const dedupeDesde = new Date(
      Date.now() - MESSAGE_DEDUPE_WINDOW_MS
    ).toISOString();
    const { data: jaExiste } = await supabase
      .from("mensagens")
      .select("id")
      .eq("beneficiario_id", params.beneficiarioId)
      .eq("template_id", template.id)
      .eq("mensagem", mensagem)
      .in("status", ["pendente", "enviando", "enviado"])
      .gte("created_at", dedupeDesde)
      .limit(1)
      .maybeSingle();
    if (jaExiste) return;
  }

  await supabase.from("mensagens").insert({
    beneficiario_id: params.beneficiarioId,
    telefone: normalizePhone(beneficiario.telefone),
    template_id: template.id,
    mensagem,
    tipo_envio: tipoEnvio,
    payload_envio: payloadEnvio,
    max_tentativas: template.max_tentativas ?? 3,
    status: "pendente",
    tentativas: 0,
    agendado_para: (params.agendadoPara ?? new Date()).toISOString(),
  });
}

async function countDueMessages(supabase: SupabaseClient, now: string) {
  const { count } = await supabase
    .from("mensagens")
    .select("*", { count: "exact", head: true })
    .in("status", ["pendente", "erro"])
    .lte("agendado_para", now)
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${now}`);

  return count ?? 0;
}

const REMINDER_EVENTOS = [
  "vencimento_3dias",
  "vencimento_dia",
  "vencimento_1dia",
] as const;

/**
 * Reagenda lembretes pendentes criados hoje mas com slot errado
 * (ex.: Edge Function antiga usava janela 8h–12h e empurrava para amanhã).
 */
async function reconcileMisscheduledReminders(supabase: SupabaseClient) {
  const todayBrazil = getBrazilDateString();
  const nowIso = new Date().toISOString();

  const { data: templates } = await supabase
    .from("mensagem_templates")
    .select("id")
    .in("evento", [...REMINDER_EVENTOS]);

  const templateIds = (templates ?? []).map((t) => t.id);
  if (templateIds.length === 0) return;

  await supabase
    .from("mensagens")
    .update({ agendado_para: nowIso })
    .eq("status", "pendente")
    .in("template_id", templateIds)
    .gte("created_at", `${todayBrazil}T00:00:00`)
    .gt("agendado_para", nowIso);
}

export async function processMessageQueue(supabase: SupabaseClient) {
  await reconcileMisscheduledReminders(supabase);

  const now = new Date().toISOString();
  const { data: pendentes } = await supabase
    .from("mensagens")
    .select("*")
    .in("status", ["pendente", "erro"])
    .lte("agendado_para", now)
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${now}`)
    .order("created_at", { ascending: true })
    .order("agendado_para", { ascending: true })
    .limit(MESSAGE_QUEUE_BATCH_LIMIT);

  const uazapiConfig = await getUazapiConfig(supabase);
  if (!uazapiConfig?.url || !uazapiConfig?.token) {
    return { processed: 0, pending: await countDueMessages(supabase, now), error: "Uazapi não configurado" };
  }

  const client = new UazapiClient(uazapiConfig);
  const readiness = await client.isReadyToSend();
  if (!readiness.ready) {
    const pendingCount = await countDueMessages(supabase, now);
    let adminAlert: { sent: boolean; reason?: string } | undefined;
    try {
      adminAlert = await alertAdminIfUazapiOffline(supabase, {
        status: readiness.status,
        error: readiness.error,
        pendingMessages: pendingCount,
      });
    } catch (e) {
      adminAlert = {
        sent: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
    return {
      processed: 0,
      pending: pendingCount,
      skipped: true,
      reason: "uazapi_offline",
      uazapiStatus: readiness.status,
      adminAlert,
      error:
        readiness.error ||
        `Uazapi não conectada (status: ${readiness.status}). Fila preservada sem gastar tentativas.`,
    };
  }

  await markUazapiOnline(supabase);

  const dueBefore = await countDueMessages(supabase, now);
  const sendIntervalMs = resolveSendIntervalMs(dueBefore, MESSAGE_SEND_INTERVAL_MS);

  let processed = 0;
  const batch = pendentes ?? [];
  const shouldThrottle = batch.length >= 2;
  let sendAttempt = 0;

  for (const msg of batch) {
    if ((msg.tentativas ?? 0) >= (msg.max_tentativas ?? 3)) continue;

    // Claim atômico: só envia se conseguir mudar pendente/erro -> enviando.
    // Evita que dois processos concorrentes enviem a mesma mensagem.
    const { data: claimed } = await supabase
      .from("mensagens")
      .update({ status: "enviando" })
      .eq("id", msg.id)
      .in("status", ["pendente", "erro"])
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    if (shouldThrottle && sendAttempt > 0) {
      await sleep(sendIntervalMs);
    }
    sendAttempt++;

    try {
      await sendQueuedMessage(client, msg as Mensagem);
      await supabase
        .from("mensagens")
        .update({
          status: "enviado",
          enviado_em: new Date().toISOString(),
          erro: null,
          proxima_tentativa_em: null,
        })
        .eq("id", msg.id);

      await createLog(supabase, {
        acao: "whatsapp_enviado",
        entidade: "mensagens",
        entidade_id: msg.id,
      });
      processed++;
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Erro desconhecido";
      const tentativas = (msg.tentativas ?? 0) + 1;
      const maxTentativas = msg.max_tentativas ?? 3;
      const { data: template } = msg.template_id
        ? await supabase
            .from("mensagem_templates")
            .select("intervalo_retry_minutos")
            .eq("id", msg.template_id)
            .maybeSingle()
        : { data: null };

      await supabase
        .from("mensagens")
        .update({
          status: "erro",
          erro,
          tentativas,
          proxima_tentativa_em:
            tentativas < maxTentativas
              ? nextRetryDate(
                  tentativas,
                  template?.intervalo_retry_minutos as number[] | null
                )
              : null,
        })
        .eq("id", msg.id);

      await createLog(supabase, {
        acao: "whatsapp_erro",
        entidade: "mensagens",
        entidade_id: msg.id,
        payload: { erro },
      });
    }
  }

  const pending = await countDueMessages(supabase, new Date().toISOString());
  return { processed, pending };
}

/** Processa a fila em rodadas até esvaziar ou atingir o limite de segurança. */
export async function drainMessageQueue(
  supabase: SupabaseClient,
  maxRounds = 20
) {
  let totalProcessed = 0;
  let pending = 0;

  for (let round = 0; round < maxRounds; round++) {
    const result = await processMessageQueue(supabase);
    totalProcessed += result.processed;
    pending = result.pending;

    if (result.processed === 0) break;
  }

  return { processed: totalProcessed, pending };
}

export async function retryMessage(
  supabase: SupabaseClient,
  messageId: string,
  userId?: string
) {
  await supabase
    .from("mensagens")
    .update({
      status: "pendente",
      agendado_para: new Date().toISOString(),
      proxima_tentativa_em: null,
      erro: null,
    })
    .eq("id", messageId);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "whatsapp_reenvio",
    entidade: "mensagens",
    entidade_id: messageId,
  });

  return drainMessageQueue(supabase);
}

export async function schedulePaymentReminders(
  supabase: SupabaseClient,
  options?: { window?: ReminderWindowOptions; immediate?: boolean }
) {
  const cron = await getCronConfig(supabase);
  const baseWindow = getReminderWindow(cron);
  const window: ReminderWindowOptions = {
    startHour: options?.window?.startHour ?? baseWindow.startHour,
    startMinute: options?.window?.startMinute ?? baseWindow.startMinute,
    endHour: options?.window?.endHour ?? baseWindow.endHour,
    endMinute: options?.window?.endMinute ?? baseWindow.endMinute,
    immediate: options?.immediate ?? options?.window?.immediate ?? false,
  };

  // Sem vencimento_7dias: com carência 5 + aviso 2, o 7º dia já é desvínculo.
  const offsets = [
    { days: 3, evento: "vencimento_3dias" },
    { days: 0, evento: "vencimento_dia" },
    { days: -1, evento: "vencimento_1dia" },
  ];

  type ReminderCandidate = {
    evento: string;
    beneficiarioId: string;
    vars: Record<string, string | number>;
  };

  const candidates: ReminderCandidate[] = [];
  const todayBrazil = getBrazilDateString();

  for (const { days, evento } of offsets) {
    const dateStr = getBrazilDateString(new Date(), days);

    const { data: template } = await supabase
      .from("mensagem_templates")
      .select("id")
      .eq("evento", evento)
      .eq("ativo", true)
      .maybeSingle();

    if (!template?.id) continue;

    const { data: cobrancas } = await supabase
      .from("cobrancas")
      .select("*, beneficiario:beneficiarios(id, nome)")
      .eq("vencimento", dateStr)
      .in("status", ["PENDING", "OVERDUE"]);

    for (const c of cobrancas ?? []) {
      const beneficiario = Array.isArray(c.beneficiario)
        ? c.beneficiario[0]
        : c.beneficiario;
      if (!beneficiario?.id) continue;

      const { data: existing } = await supabase
        .from("mensagens")
        .select("id")
        .eq("beneficiario_id", beneficiario.id)
        .eq("template_id", template.id)
        .gte("created_at", `${todayBrazil}T00:00:00`)
        .maybeSingle();

      if (existing) continue;

      const baseVars = {
        nome: beneficiario.nome,
        valor: Number(c.valor).toFixed(2).replace(".", ","),
        data_vencimento: dateStr.split("-").reverse().join("/"),
      };

      const vars = c.asaas_payment_id
        ? await buildPaymentTemplateVars(supabase, c.asaas_payment_id, baseVars)
        : {
            ...baseVars,
            link_fatura: "",
            codigo_pix: "",
            linha_digitavel: "",
          };

      candidates.push({
        evento,
        beneficiarioId: beneficiario.id,
        vars,
      });
    }
  }

  const slots = computeReminderScheduleSlots(candidates.length, new Date(), window);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    await scheduleMessage(supabase, {
      evento: candidate.evento,
      beneficiarioId: candidate.beneficiarioId,
      vars: candidate.vars,
      agendadoPara: slots[index],
    });
  }

  return { scheduled: candidates.length };
}
