import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfigAsaas,
  ConfigBridge,
  ConfigCron,
  ConfigEmpresa,
  ConfigFinanceiro,
  ConfigInfinity,
  ConfigUazapi,
} from "@/types/database";
import {
  DEFAULT_BRIDGE_CONFIG,
  DEFAULT_INFINITY_CONFIG,
  getDefaultUazapiWebhookToken,
  getUazapiWebhookUrl,
} from "@/types/database";

export async function getConfig<T>(
  supabase: SupabaseClient,
  chave: string
): Promise<T | null> {
  const { data } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", chave)
    .single();
  return (data?.valor as T) ?? null;
}

export async function getAsaasConfig(supabase: SupabaseClient) {
  const config = await getConfig<ConfigAsaas>(supabase, "asaas");
  const envKey = sanitizeAsaasApiKey(process.env.ASAAS_API_KEY ?? "");
  const configKey = sanitizeAsaasApiKey(config?.api_key ?? "");

  return {
    api_key: envKey || configKey || "",
    ambiente:
      (process.env.ASAAS_ENVIRONMENT as ConfigAsaas["ambiente"] | undefined) ||
      config?.ambiente ||
      "sandbox",
    webhook_token:
      process.env.ASAAS_WEBHOOK_TOKEN || config?.webhook_token || "",
    webhook_url: process.env.ASAAS_WEBHOOK_URL || config?.webhook_url,
  };
}

export async function getUazapiConfig(supabase: SupabaseClient) {
  const config = await getConfig<ConfigUazapi>(supabase, "uazapi");
  const webhook_token =
    process.env.UAZAPI_WEBHOOK_TOKEN ||
    config?.webhook_token ||
    getDefaultUazapiWebhookToken();

  return {
    url: process.env.UAZAPI_URL || config?.url || "",
    token: process.env.UAZAPI_TOKEN || config?.token || "",
    instancia: process.env.UAZAPI_INSTANCIA || config?.instancia || "",
    webhook_token,
    webhook_url:
      process.env.UAZAPI_WEBHOOK_URL ||
      config?.webhook_url ||
      getUazapiWebhookUrl(webhook_token),
    etiquetas_monitoradas:
      config?.etiquetas_monitoradas?.length
        ? config.etiquetas_monitoradas
        : undefined,
  };
}

export async function getFinanceiroConfig(supabase: SupabaseClient) {
  return getConfig<ConfigFinanceiro>(supabase, "financeiro");
}

export async function getEmpresaConfig(supabase: SupabaseClient) {
  return getConfig<ConfigEmpresa>(supabase, "empresa");
}

export async function getCronConfigRaw(supabase: SupabaseClient) {
  return getConfig<ConfigCron>(supabase, "cron");
}

export async function getBridgeConfigRaw(supabase: SupabaseClient) {
  const raw = await getConfig<ConfigBridge>(supabase, "bridge");
  return {
    ...DEFAULT_BRIDGE_CONFIG,
    ...raw,
    admin_telefone: raw?.admin_telefone?.trim() || "",
    admin_email: raw?.admin_email?.trim() || "",
    automacao_inativacao_ativa: raw?.automacao_inativacao_ativa !== false,
  } satisfies Required<ConfigBridge>;
}

export async function getInfinityConfigRaw(supabase: SupabaseClient) {
  const raw = await getConfig<ConfigInfinity>(supabase, "infinity");
  const envSecret = process.env.INFINITY_BRIDGE_SECRET?.trim() || "";
  return {
    ...DEFAULT_INFINITY_CONFIG,
    ...raw,
    ativa: raw?.ativa === true,
    automacao_desvinculo_ativa: raw?.automacao_desvinculo_ativa === true,
    dry_run: raw?.dry_run !== false,
    admin_telefone: raw?.admin_telefone?.trim() || "",
    admin_email: raw?.admin_email?.trim() || "",
    bridge_secret: envSecret || raw?.bridge_secret?.trim() || "",
  } satisfies Required<ConfigInfinity>;
}

export async function updateConfig(
  supabase: SupabaseClient,
  chave: string,
  valor: Record<string, unknown>
) {
  const existing = await getConfig<Record<string, unknown>>(supabase, chave);
  const merged = { ...(existing ?? {}), ...valor };

  const { data, error } = await supabase
    .from("configuracoes")
    .update({ valor: merged, updated_at: new Date().toISOString() })
    .eq("chave", chave)
    .select("chave")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: insertError } = await supabase.from("configuracoes").insert({
      chave,
      valor: merged,
      updated_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
  }
}

/** Remove escape/lixo comum em chaves Asaas copiadas do .env. */
export function sanitizeAsaasApiKey(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/\$aact_[^\s"'\\]+/);
  if (match) return match[0];
  return trimmed.replace(/^\\+/, "");
}
