import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runWhatsappAudit } from "@/lib/services/whatsapp-audit";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("id, role, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil?.ativo || perfil.role !== "admin") return null;
  return { userId: user.id };
}

/**
 * Auditoria WhatsApp ↔ Manager.
 * Puxa chats com etiquetas Cliente TotalPass / Cliente Gympass
 * (mesmo com CANCELADO junto) e cruza por telefone.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await createServiceClient()
      : await createClient();
    const result = await runWhatsappAudit(service);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na auditoria" },
      { status: 500 }
    );
  }
}
