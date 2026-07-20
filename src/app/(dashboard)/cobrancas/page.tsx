import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CobrancasList } from "@/components/cobrancas/cobrancas-list";
import { DesvinculosPendentesPanel } from "@/components/cobrancas/desvinculos-pendentes-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { listDesvinculosPendentesManuais } from "@/lib/services/overdue-inactivation";

export default async function CobrancasPage() {
  const supabase = await createClient();

  const { data: cobrancas } = await supabase
    .from("cobrancas")
    .select("*, beneficiario:beneficiarios(*)")
    .order("vencimento", { ascending: false });

  let pendentesDesvinculo: Awaited<
    ReturnType<typeof listDesvinculosPendentesManuais>
  > = [];

  try {
    const client = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await createServiceClient()
      : supabase;
    pendentesDesvinculo = await listDesvinculosPendentesManuais(client, 50);
  } catch {
    // painel opcional — não quebra a página de cobranças
  }

  return (
    <DashboardShell title="Cobranças">
      <RealtimeRefresher tables={["cobrancas", "beneficiarios"]} />
      <BackgroundSync tipo="cobrancas" />
      <div className="space-y-4">
        <DesvinculosPendentesPanel itens={pendentesDesvinculo} />
        <CobrancasList cobrancas={cobrancas ?? []} />
      </div>
    </DashboardShell>
  );
}
