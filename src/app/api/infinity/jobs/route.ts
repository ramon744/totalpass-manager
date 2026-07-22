import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  enqueueInfinityJob,
  getInfinityJobsSummary,
  type InfinityJobTipo,
} from "@/lib/services/infinity-jobs";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!perfil?.ativo || perfil.role !== "admin") return null;
  return { userId: user.id, supabase };
}

/** Resumo da fila Infinity (admin). */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : admin.supabase;
  const summary = await getInfinityJobsSummary(service);
  return NextResponse.json({ ok: true, ...summary });
}

/** Enfileira job create/cancel (admin). Em dry-run a extensão só simula. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: {
    tipo?: InfinityJobTipo;
    beneficiarioId?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.tipo !== "create_charge" && body.tipo !== "cancel_subscription") {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (!body.beneficiarioId?.trim()) {
    return NextResponse.json(
      { error: "beneficiarioId obrigatório" },
      { status: 400 }
    );
  }

  try {
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await createServiceClient()
      : admin.supabase;
    const job = await enqueueInfinityJob(service, {
      tipo: body.tipo,
      beneficiarioId: body.beneficiarioId.trim(),
      payload: body.payload,
      userId: admin.userId,
    });
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao enfileirar" },
      { status: 400 }
    );
  }
}
