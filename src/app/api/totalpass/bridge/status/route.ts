import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getBridgeStatusSummary,
  retryFailedBridgeJobs,
} from "@/lib/services/bridge-jobs";

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

/** Status da bridge para painel admin. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const service = await createServiceClient();
  const summary = await getBridgeStatusSummary(service);
  return NextResponse.json(summary);
}

/** Reprocessa jobs failed → pending. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let action = "retry_failed";
  try {
    const body = await request.json();
    action = body?.action || action;
  } catch {
    // body opcional
  }

  if (action !== "retry_failed") {
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  }

  const service = await createServiceClient();
  const retried = await retryFailedBridgeJobs(service);
  return NextResponse.json({ ok: true, retried });
}
