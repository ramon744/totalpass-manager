import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createBeneficiario } from "@/lib/services/beneficiarios";
import type { BeneficiarioInput } from "@/lib/services/beneficiarios";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as BeneficiarioInput;
  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    const created = await createBeneficiario(serviceClient, body, user.id);
    return NextResponse.json(created);
  } catch (e) {
    console.error("[api/beneficiarios] erro ao criar:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar" },
      { status: 400 }
    );
  }
}
