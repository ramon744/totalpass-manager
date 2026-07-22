import { DashboardShell } from "@/components/layout/dashboard-shell";
import { BeneficiariosResumoPanel } from "@/components/beneficiarios/beneficiarios-resumo";
import { ProvedoresResumoPanel } from "@/components/dashboard/provedores-resumo";
import { DashboardFinanceiroSection } from "@/components/dashboard/dashboard-financeiro";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/services/dashboard";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";

export default async function DashboardPage() {
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase);

  const { data: cobrancasMensais } = await supabase
    .from("cobrancas")
    .select("valor, status, vencimento, data_pagamento")
    .order("vencimento");

  const { data: beneficiarios } = await supabase
    .from("beneficiarios")
    .select("status_totalpass, plano, perfil");

  const realtimeTables = stats.infinityAtiva
    ? (["beneficiarios", "assinaturas", "cobrancas", "infinity_customer_status"] as const)
    : (["beneficiarios", "assinaturas", "cobrancas"] as const);

  return (
    <DashboardShell title="Dashboard">
      <RealtimeRefresher tables={[...realtimeTables]} />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Beneficiários TotalPass</h2>
        <BeneficiariosResumoPanel
          titulares={stats.titulares}
          dependentes={stats.dependentes}
          totalBeneficiarios={stats.totalBeneficiarios}
        />
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold">Por provedor</h2>
        <ProvedoresResumoPanel provedores={stats.provedores} />
      </section>

      <DashboardFinanceiroSection stats={stats} />

      <div className="mt-8">
        <DashboardCharts
          cobrancas={cobrancasMensais ?? []}
          beneficiarios={beneficiarios ?? []}
        />
      </div>
    </DashboardShell>
  );
}
