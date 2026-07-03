import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ConfiguracoesForm } from "@/components/configuracoes/configuracoes-form";
import { createClient } from "@/lib/supabase/server";
import {
  getAsaasConfig,
  getEmpresaConfig,
  getFinanceiroConfig,
  getUazapiConfig,
} from "@/lib/config";
import { getCronConfig } from "@/lib/cron-config";
import { DEFAULT_ETIQUETAS_MONITORADAS, getAsaasWebhookUrl, getDefaultUazapiWebhookToken, getUazapiWebhookUrl } from "@/types/database";

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const [empresa, financeiro, asaas, uazapi, cron] = await Promise.all([
    getEmpresaConfig(supabase),
    getFinanceiroConfig(supabase),
    getAsaasConfig(supabase),
    getUazapiConfig(supabase),
    getCronConfig(supabase),
  ]);

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
      />
    </DashboardShell>
  );
}
