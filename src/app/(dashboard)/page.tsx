import { DashboardShell } from "@/components/layout/dashboard-shell";
import { BeneficiariosResumoPanel } from "@/components/beneficiarios/beneficiarios-resumo";
import { ProvedoresResumoPanel } from "@/components/dashboard/provedores-resumo";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/services/dashboard";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const financeCards = [
    { label: "Assinaturas ativas", value: stats.assinaturasAtivas },
    { label: "Cobranças pendentes", value: stats.cobrancasPendentes },
    { label: "Cobranças vencidas", value: stats.cobrancasVencidas },
    { label: "Receita prevista", value: formatCurrency(stats.receitaPrevista) },
    { label: "Receita recebida", value: formatCurrency(stats.receitaRecebida) },
    { label: "Inadimplência", value: `${stats.inadimplencia.toFixed(1)}%` },
  ];

  return (
    <DashboardShell title="Dashboard">
      <RealtimeRefresher tables={["beneficiarios", "assinaturas", "cobrancas"]} />
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

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold">Financeiro</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {financeCards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-8">
        <DashboardCharts
          cobrancas={cobrancasMensais ?? []}
          beneficiarios={beneficiarios ?? []}
        />
      </div>
    </DashboardShell>
  );
}
