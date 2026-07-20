import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AuditoriasTabs } from "@/components/auditorias/auditorias-tabs";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AuditoriaWhatsappPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil?.ativo || perfil.role !== "admin") {
    redirect("/");
  }

  return (
    <DashboardShell title="Auditorias">
      <AuditoriasTabs />
    </DashboardShell>
  );
}
