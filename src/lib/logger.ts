import type { SupabaseClient } from "@supabase/supabase-js";

export async function createLog(
  supabase: SupabaseClient,
  entry: {
    usuario_id?: string | null;
    acao: string;
    entidade?: string;
    entidade_id?: string;
    payload?: Record<string, unknown>;
    ip?: string;
  }
) {
  await supabase.from("logs").insert({
    usuario_id: entry.usuario_id ?? null,
    acao: entry.acao,
    entidade: entry.entidade ?? null,
    entidade_id: entry.entidade_id ?? null,
    payload: entry.payload ?? null,
    ip: entry.ip ?? null,
  });
}
