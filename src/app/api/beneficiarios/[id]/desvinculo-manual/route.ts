import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireActiveAdmin } from "@/lib/auth-admin";
import { desvincularBeneficiarioManual } from "@/lib/services/desvinculo-manual";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    await requireActiveAdmin(supabase, user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sem permissão" },
      { status: 403 }
    );
  }

  let body: { confirmouHr?: boolean; notificar?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    const result = await desvincularBeneficiarioManual(serviceClient, id, {
      userId: user.id,
      confirmouHr: body.confirmouHr === true,
      notificar: body.notificar === true,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no desvínculo manual" },
      { status: 400 }
    );
  }
}
