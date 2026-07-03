import { DashboardShell } from "@/components/layout/dashboard-shell";
import { RelatoriosPanel } from "@/components/relatorios/relatorios-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/services/dashboard";

export default async function RelatoriosPage() {
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase);

  const { data: beneficiarios } = await supabase
    .from("beneficiarios")
    .select("plano, status_totalpass");

  const planosMap = (beneficiarios ?? []).reduce<Record<string, number>>(
    (acc, b) => {
      const plano = b.plano || "Sem plano";
      acc[plano] = (acc[plano] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const { data: cobrancas } = await supabase.from("cobrancas").select("valor, status");
  const receitaAberta =
    cobrancas
      ?.filter((c) => ["PENDING", "OVERDUE"].includes(c.status))
      .reduce((s, c) => s + Number(c.valor), 0) ?? 0;

  return (
    <DashboardShell title="Relatórios">
      <RealtimeRefresher tables={["beneficiarios", "cobrancas", "assinaturas"]} />
      <RelatoriosPanel
        stats={{
          receitaPrevista: stats.receitaPrevista,
          receitaRecebida: stats.receitaRecebida,
          receitaAberta,
          titulares: stats.titulares,
          dependentes: stats.dependentes,
          inadimplencia: stats.inadimplencia,
          planos: Object.entries(planosMap).map(([plano, total]) => ({
            plano,
            total,
          })),
        }}
      />
    </DashboardShell>
  );
}
