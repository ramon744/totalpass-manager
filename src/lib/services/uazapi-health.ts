import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import { notifyAdminAlert } from "@/lib/services/admin-alerts";

type UazapiHealthState = {
  last_offline_alert_at?: string | null;
  last_status?: string | null;
  last_online_at?: string | null;
};

async function upsertUazapiHealth(
  supabase: SupabaseClient,
  patch: UazapiHealthState
) {
  const current =
    (await getConfig<UazapiHealthState>(supabase, "uazapi_health")) ?? {};
  const valor = { ...current, ...patch };
  const { error } = await supabase.from("configuracoes").upsert(
    {
      chave: "uazapi_health",
      valor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" }
  );
  if (error) throw new Error(error.message);
  return valor;
}

/**
 * Quando a Uazapi volta a ficar online, limpa o estado de alerta
 * para o próximo downtime avisar na hora.
 */
export async function markUazapiOnline(supabase: SupabaseClient) {
  try {
    await upsertUazapiHealth(supabase, {
      last_online_at: new Date().toISOString(),
      last_status: "connected",
    });
  } catch {
    // não bloqueia a fila
  }
}

/**
 * Avisa o admin que a Uazapi/WhatsApp está desconectada.
 * E-mail é o canal principal; WhatsApp só se por acaso a API responder (raro).
 */
export async function alertAdminIfUazapiOffline(
  supabase: SupabaseClient,
  params: {
    status: string;
    error?: string;
    pendingMessages: number;
  }
): Promise<{ sent: boolean; reason?: string }> {
  const health =
    (await getConfig<UazapiHealthState>(supabase, "uazapi_health")) ?? {};

  // Throttle próprio + o do notifyAdminAlert (chave fixa)
  const quando = new Date().toLocaleString("pt-BR");
  const text = [
    "⚠️ WhatsApp (Uazapi) desconectado",
    "",
    "A instância Uazapi está offline/desconectada. Enquanto isso, as",
    "notificações WhatsApp para os clientes NÃO serão enviadas",
    "(a fila fica preservada, sem gastar tentativas).",
    "",
    `Status: ${params.status}`,
    params.error ? `Detalhe: ${params.error}` : null,
    `Mensagens aguardando na fila: ${params.pendingMessages}`,
    `Detectado em: ${quando}`,
    "",
    "O que fazer:",
    "1) Abra o painel da Uazapi",
    "2) Conecte/escaneie o QR e faça login no WhatsApp novamente",
    "3) Confirme que a instância ficou 'connected'",
    "",
    "Assim que reconectar, o Manager volta a enviar a fila automaticamente.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await notifyAdminAlert(supabase, {
    throttleKey: "uazapi_offline",
    subject: `[TotalPass] WhatsApp/Uazapi desconectado — reconecte`,
    text,
    logAction: "uazapi_offline_admin_alert",
    logPayload: {
      status: params.status,
      error: params.error ?? null,
      pending: params.pendingMessages,
    },
  });

  if (result.sent) {
    await upsertUazapiHealth(supabase, {
      last_offline_alert_at: new Date().toISOString(),
      last_status: params.status,
    });
  } else if (health.last_offline_alert_at && result.reason === "alerta em throttle") {
    // ok
  }

  return { sent: result.sent, reason: result.reason };
}
