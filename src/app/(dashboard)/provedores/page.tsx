import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ProvedoresList } from "@/components/provedores/provedores-list";
import { createClient } from "@/lib/supabase/server";
import type { Beneficiario, Provedor } from "@/types/database";

export default async function ProvedoresPage() {
  const supabase = await createClient();

  const [{ data: provedores }, { data: beneficiarios }] = await Promise.all([
    supabase.from("provedores").select("*").order("nome"),
    supabase.from("beneficiarios").select("*").not("provedor_id", "is", null),
  ]);

  const lista = (provedores ?? []).map((p) => {
    const vinculados = (beneficiarios ?? []).filter(
      (b) => b.provedor_id === p.id
    ) as Beneficiario[];

    const titulares = vinculados
      .filter((b) => b.perfil === "titular")
      .map((t) => ({
        ...t,
        dependentes: vinculados.filter((d) => d.titular_id === t.id),
      }));

    const titularIds = new Set(titulares.map((t) => t.id));
    const dependentesAvulsos = vinculados.filter(
      (b) => b.perfil === "dependente" && (!b.titular_id || !titularIds.has(b.titular_id))
    );

    return {
      ...(p as Provedor),
      titulares,
      totalTitulares: titulares.length,
      totalDependentes:
        titulares.reduce((acc, t) => acc + t.dependentes.length, 0) +
        dependentesAvulsos.length,
      totalBeneficiarios: vinculados.length,
    };
  });

  return (
    <DashboardShell title="Provedores">
      <ProvedoresList provedores={lista} />
    </DashboardShell>
  );
}
