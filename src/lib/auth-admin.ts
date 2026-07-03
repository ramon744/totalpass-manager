import type { SupabaseClient } from "@supabase/supabase-js";

export async function requireActiveAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("role, ativo")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Não foi possível verificar permissões");
  }

  if (!data?.ativo || data.role !== "admin") {
    throw new Error("Apenas administradores podem executar esta ação");
  }
}
