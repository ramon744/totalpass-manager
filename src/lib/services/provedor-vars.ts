import type { SupabaseClient } from "@supabase/supabase-js";

/** Retorna o benefício do provedor vinculado ao beneficiário (ou do titular, se dependente). */
export async function resolveBeneficioFornecido(
  supabase: SupabaseClient,
  beneficiarioId: string
): Promise<string> {
  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("provedor_id, titular_id")
    .eq("id", beneficiarioId)
    .maybeSingle();

  if (!beneficiario) return "";

  let provedorId = beneficiario.provedor_id;

  if (!provedorId && beneficiario.titular_id) {
    const { data: titular } = await supabase
      .from("beneficiarios")
      .select("provedor_id")
      .eq("id", beneficiario.titular_id)
      .maybeSingle();
    provedorId = titular?.provedor_id ?? null;
  }

  if (!provedorId) return "";

  const { data: provedor } = await supabase
    .from("provedores")
    .select("beneficio")
    .eq("id", provedorId)
    .maybeSingle();

  return provedor?.beneficio?.trim() ?? "";
}
