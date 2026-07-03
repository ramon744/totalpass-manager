import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CobrancasList } from "@/components/cobrancas/cobrancas-list";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient } from "@/lib/supabase/server";

export default async function CobrancasPage() {
  const supabase = await createClient();

  const { data: cobrancas } = await supabase
    .from("cobrancas")
    .select("*, beneficiario:beneficiarios(*)")
    .order("vencimento", { ascending: false });

  return (
    <DashboardShell title="Cobranças">
      <RealtimeRefresher tables={["cobrancas", "beneficiarios"]} />
      <BackgroundSync tipo="cobrancas" />
      <CobrancasList cobrancas={cobrancas ?? []} />
    </DashboardShell>
  );
}
