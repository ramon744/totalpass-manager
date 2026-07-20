import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ConfiguracoesForm } from "@/components/configuracoes/configuracoes-form";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getAsaasConfig,
  getBridgeConfigRaw,
  getEmpresaConfig,
  getFinanceiroConfig,
  getInfinityConfigRaw,
  getUazapiConfig,
} from "@/lib/config";
import { getCronConfig } from "@/lib/cron-config";
import { getBridgeStatusSummary } from "@/lib/services/bridge-jobs";
import { getInfinityStatusSummary } from "@/lib/services/infinity-bridge";
import {
  DEFAULT_BRIDGE_CONFIG,
  DEFAULT_ETIQUETAS_MONITORADAS,
  DEFAULT_INFINITY_CONFIG,
  getAsaasWebhookUrl,
  getDefaultUazapiWebhookToken,
  getUazapiWebhookUrl,
} from "@/types/database";

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const [empresa, financeiro, asaas, uazapi, cron, bridge, infinity] =
    await Promise.all([
      getEmpresaConfig(supabase),
      getFinanceiroConfig(supabase),
      getAsaasConfig(supabase),
      getUazapiConfig(supabase),
      getCronConfig(supabase),
      getBridgeConfigRaw(supabase),
      getInfinityConfigRaw(supabase),
    ]);

  let bridgeStatus = {
    instances: [] as Awaited<ReturnType<typeof getBridgeStatusSummary>>["instances"],
    pending: 0,
    failed: 0,
    succeededToday: 0,
    pendentesManuaisCount: 0,
  };

  let infinityStatus: Awaited<ReturnType<typeof getInfinityStatusSummary>> = {
    instances: [],
    overdue: 0,
    pending: 0,
    paid: 0,
    health: {
      online: false,
      reason: "nenhuma_extensao",
      lastSeenAt: null,
      sessionOk: null,
      installationId: null,
      lastError: null,
      extensionVersion: null,
      lastOfflineAlertAt: null,
      overdueCount: 0,
    },
  };

  try {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const service = await createServiceClient();
      const [bridgeSum, infinitySum] = await Promise.all([
        getBridgeStatusSummary(service),
        getInfinityStatusSummary(service).catch(() => infinityStatus),
      ]);
      bridgeStatus = bridgeSum;
      infinityStatus = infinitySum;
    }
  } catch {
    // painel opcional
  }

  return (
    <DashboardShell title="Configurações">
      <ConfiguracoesForm
        empresa={empresa ?? { nome: "", cnpj: "", logo_url: "" }}
        financeiro={
          financeiro ?? {
            valor_mensalidade_padrao: 16.99,
            dia_vencimento_padrao: 10,
            descricao_padrao: "Mensalidade TotalPass",
            forma_pagamento_padrao: "BOLETO",
          }
        }
        asaas={{
          api_key: asaas?.api_key ?? "",
          ambiente: asaas?.ambiente ?? "sandbox",
          webhook_token:
            asaas?.webhook_token ?? "tp_wh_2026_M7kP4xQ9vL2nR8sW5zA3",
          webhook_url: asaas?.webhook_url ?? getAsaasWebhookUrl(),
        }}
        uazapi={{
          ...(uazapi ?? { url: "", token: "", instancia: "" }),
          webhook_token:
            uazapi?.webhook_token ?? getDefaultUazapiWebhookToken(),
          webhook_url:
            uazapi?.webhook_url ??
            getUazapiWebhookUrl(
              uazapi?.webhook_token ?? getDefaultUazapiWebhookToken()
            ),
          etiquetas_monitoradas:
            uazapi?.etiquetas_monitoradas ?? [...DEFAULT_ETIQUETAS_MONITORADAS],
        }}
        cron={cron}
        bridge={bridge ?? DEFAULT_BRIDGE_CONFIG}
        infinity={{
          ...(infinity ?? DEFAULT_INFINITY_CONFIG),
          bridge_secret: "",
        }}
        bridgeStatus={bridgeStatus}
        infinityStatus={infinityStatus}
      />
    </DashboardShell>
  );
}
