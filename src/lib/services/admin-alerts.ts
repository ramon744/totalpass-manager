import type { SupabaseClient } from "@supabase/supabase-js";
import { getBridgeConfigRaw, getConfig, getUazapiConfig } from "@/lib/config";
import { sendAdminEmail } from "@/lib/email/resend";
import { createLog } from "@/lib/logger";
import { UazapiClient } from "@/lib/uazapi/client";
import { normalizePhone } from "@/lib/utils";

type AlertThrottleState = Record<string, string>; // key -> ISO last sent

async function readThrottle(supabase: SupabaseClient) {
  return (
    (await getConfig<AlertThrottleState>(supabase, "admin_alert_throttle")) ??
    {}
  );
}

async function writeThrottle(
  supabase: SupabaseClient,
  state: AlertThrottleState
) {
  const { error } = await supabase.from("configuracoes").upsert(
    {
      chave: "admin_alert_throttle",
      valor: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" }
  );
  if (error) throw new Error(error.message);
}

/**
 * Erros que sugerem mudança no HR/API TotalPass (precisa remapear).
 */
export function looksLikeTotalPassApiBreak(error: string | null | undefined) {
  const msg = String(error || "");
  return /HTTP 404|HTTP 405|HTTP 5\d\d|unexpected|HTML|<!DOCTYPE|JSON\.parse|Unexpected token|Cannot read|employees\/(search|inactivate)|company_groups|endpoint|não encontrado|not found|invalid response/i.test(
    msg
  );
}

/**
 * Notifica o admin por e-mail e, se a Uazapi estiver conectada, também por WhatsApp.
 * `throttleKey` evita spam (usa intervalo da Bridge).
 * `throttleOnce` = true: só um alerta por chave (ex.: por job id), sem reenviar no intervalo.
 */
export async function notifyAdminAlert(
  supabase: SupabaseClient,
  params: {
    throttleKey: string;
    subject: string;
    text: string;
    /** Se true, nunca reenvia a mesma chave (até limpar throttle). */
    throttleOnce?: boolean;
    logAction?: string;
    logPayload?: Record<string, unknown>;
  }
): Promise<{
  sent: boolean;
  reason?: string;
  channels?: { email?: boolean; whatsapp?: boolean };
}> {
  const bridge = await getBridgeConfigRaw(supabase);
  const hasEmail = Boolean(bridge.admin_email);
  const hasWhatsApp = Boolean(bridge.admin_telefone);

  if (!hasEmail && !hasWhatsApp) {
    return {
      sent: false,
      reason: "configure admin_email e/ou admin_telefone",
    };
  }

  const throttle = await readThrottle(supabase);
  const last = throttle[params.throttleKey];
  if (last) {
    if (params.throttleOnce) {
      return { sent: false, reason: "já alertado para esta chave" };
    }
    const intervalMs = bridge.alerta_offline_intervalo_horas * 60 * 60_000;
    if (Date.now() - new Date(last).getTime() < intervalMs) {
      return { sent: false, reason: "alerta em throttle" };
    }
  }

  const channels: { email?: boolean; whatsapp?: boolean } = {};
  const errors: string[] = [];

  // Prioridade WhatsApp; e-mail só se WA não enviar
  if (hasWhatsApp) {
    const uazapi = await getUazapiConfig(supabase);
    if (!uazapi.url || !uazapi.token) {
      errors.push("whatsapp: uazapi não configurado");
    } else {
      const client = new UazapiClient(uazapi);
      const readiness = await client.isReadyToSend();
      if (!readiness.ready) {
        errors.push(`whatsapp pulado: uazapi ${readiness.status}`);
      } else {
        try {
          const waText =
            params.text.length > 3500
              ? `${params.text.slice(0, 3400)}\n…`
              : params.text;
          await client.sendText(
            normalizePhone(bridge.admin_telefone!),
            waText
          );
          channels.whatsapp = true;
        } catch (e) {
          errors.push(
            `whatsapp: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }
  }

  if (hasEmail && !channels.whatsapp) {
    const emailResult = await sendAdminEmail({
      to: bridge.admin_email!,
      subject: params.subject,
      text: params.text,
    });
    if (emailResult.ok) channels.email = true;
    else errors.push(`email: ${emailResult.reason}`);
  }

  const sent = Boolean(channels.email || channels.whatsapp);
  if (!sent) {
    return {
      sent: false,
      reason: errors.join("; ") || "nenhum canal enviou",
      channels,
    };
  }

  throttle[params.throttleKey] = new Date().toISOString();
  await writeThrottle(supabase, throttle);

  await createLog(supabase, {
    acao: params.logAction ?? "admin_alert",
    entidade: "configuracoes",
    payload: {
      throttleKey: params.throttleKey,
      channels,
      errors: errors.length ? errors : undefined,
      ...(params.logPayload ?? {}),
    },
  });

  return {
    sent: true,
    channels,
    reason: errors.length ? errors.join("; ") : undefined,
  };
}

export async function alertAdminBridgeJobFailed(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    cpfTail: string;
    error: string;
    attempts: number;
  }
) {
  const structural = looksLikeTotalPassApiBreak(params.error);
  const text = [
    structural
      ? "🚨 Possível mudança/quebra na API do TotalPass HR"
      : "⚠️ Job de inativação TotalPass falhou",
    "",
    `Job: ${params.jobId}`,
    `CPF (final): ${params.cpfTail}`,
    `Tentativas: ${params.attempts}`,
    `Erro: ${params.error}`,
    "",
    structural
      ? "Ação: abra o HR, capture Network/HAR se necessário e remapeie a extensão."
      : "Ação: confira sessão da extensão, CPF no HR e reprocesse o job se fizer sentido.",
    `Detectado em: ${new Date().toLocaleString("pt-BR")}`,
  ].join("\n");

  return notifyAdminAlert(supabase, {
    throttleKey: `bridge_job_failed:${params.jobId}`,
    throttleOnce: true,
    subject: structural
      ? `[TotalPass] API HR pode ter mudado — job falhou`
      : `[TotalPass] Inativação falhou — job ${params.jobId.slice(0, 8)}`,
    text,
    logAction: "bridge_job_failed_admin_alert",
    logPayload: {
      jobId: params.jobId,
      structural,
      error: params.error.slice(0, 300),
    },
  });
}

export async function alertAdminTotalPassIntegrationBroken(
  supabase: SupabaseClient,
  params: {
    installationId: string;
    error: string;
    sessionOk: boolean;
  }
) {
  const text = [
    "🚨 Integração TotalPass HR com problema",
    "",
    "A extensão reportou falha que pode indicar mudança no painel/API do HR.",
    "",
    `Instalação: ${params.installationId}`,
    `Sessão HR ok: ${params.sessionOk ? "sim" : "não"}`,
    `Erro: ${params.error}`,
    "",
    "O que fazer:",
    "1) Abra hr.totalpass.com logado",
    "2) Confira se a extensão captura sessão",
    "3) Se APIs mudaram, capture HAR/Network e remapeie a extensão",
    "",
    `Detectado em: ${new Date().toLocaleString("pt-BR")}`,
  ].join("\n");

  return notifyAdminAlert(supabase, {
    throttleKey: "tp_integration_broken",
    subject: `[TotalPass] Integração HR com erro — verificar/remapear`,
    text,
    logAction: "tp_integration_broken_admin_alert",
    logPayload: {
      installationId: params.installationId,
      error: params.error.slice(0, 300),
      sessionOk: params.sessionOk,
    },
  });
}
