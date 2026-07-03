import { DashboardShell } from "@/components/layout/dashboard-shell";
import { FinanceiroPanel } from "@/components/financeiro/financeiro-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient } from "@/lib/supabase/server";
import { getFinanceiroConfig } from "@/lib/config";
import { toProvedoresMap } from "@/lib/assinatura-defaults";
import type { Beneficiario, PreCadastroWhatsapp, Provedor } from "@/types/database";

export default async function FinanceiroPage() {
  const supabase = await createClient();

  const [
    { data: beneficiariosCobraveis },
    { data: assinaturasAtivas },
    { data: provedores },
    { data: preCadastros },
    financeiro,
  ] = await Promise.all([
    supabase
      .from("beneficiarios")
      .select("*")
      .neq("status_totalpass", "inativo")
      .order("nome"),
    supabase.from("assinaturas").select("beneficiario_id").eq("status", "ACTIVE"),
    supabase.from("provedores").select("*"),
    supabase
      .from("pre_cadastros_whatsapp")
      .select("*")
      .order("data_etiqueta", { ascending: false }),
    getFinanceiroConfig(supabase),
  ]);

  const provedoresById = toProvedoresMap((provedores ?? []) as Provedor[]);

  const comAssinatura = new Set(
    (assinaturasAtivas ?? []).map((a) => a.beneficiario_id)
  );

  const titulares = (beneficiariosCobraveis ?? [])
    .filter((b) => b.perfil === "titular")
    .map((t) => ({
      ...(t as Beneficiario),
      dependentes: (beneficiariosCobraveis ?? []).filter(
        (d) => d.titular_id === t.id
      ) as Beneficiario[],
    }));

  const pendentes = titulares.filter((b) => !comAssinatura.has(b.id));

  return (
    <DashboardShell title="Clientes Pendentes de Cobrança">
      <RealtimeRefresher tables={["beneficiarios", "assinaturas"]} />
      <BackgroundSync tipo="subscriptions" />
      <FinanceiroPanel
        pendentes={pendentes}
        preCadastros={(preCadastros ?? []) as PreCadastroWhatsapp[]}
        defaults={{
          valor: financeiro?.valor_mensalidade_padrao ?? 16.99,
          dia: financeiro?.dia_vencimento_padrao ?? 10,
          descricao: financeiro?.descricao_padrao ?? "Mensalidade TotalPass",
        }}
        provedoresById={provedoresById}
      />
    </DashboardShell>
  );
}
