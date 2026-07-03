import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfigAsaas,
  ConfigCron,
  ConfigEmpresa,
  ConfigFinanceiro,
  ConfigUazapi,
} from "@/types/database";
import {
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

  return {
    api_key: process.env.ASAAS_API_KEY || config?.api_key || "",
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

export async function updateConfig(
  supabase: SupabaseClient,
  chave: string,
  valor: Record<string, unknown>
) {
  const { error } = await supabase
    .from("configuracoes")
    .update({ valor, updated_at: new Date().toISOString() })
    .eq("chave", chave);
  if (error) throw error;
}
