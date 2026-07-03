import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { reconcileDependentBillingForTitular } from "@/lib/services/subscriptions";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    dependenteId?: string;
    cobrar?: boolean;
    motivo?: string;
  };

  if (!body.dependenteId || typeof body.cobrar !== "boolean") {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  const { data: dependente } = await serviceClient
    .from("beneficiarios")
    .select("id, titular_id, cobrar_na_assinatura")
    .eq("id", body.dependenteId)
    .eq("perfil", "dependente")
    .single();

  if (!dependente?.titular_id) {
    return NextResponse.json({ error: "Dependente não encontrado" }, { status: 404 });
  }

  const wasDisabled = dependente.cobrar_na_assinatura !== true;
  const now = new Date().toISOString();

  const { error } = await serviceClient
    .from("beneficiarios")
    .update({
      cobrar_na_assinatura: body.cobrar,
      cobranca_manual_desativada_em: body.cobrar ? null : now,
      cobranca_manual_desativada_por: body.cobrar ? null : user.id,
      cobranca_manual_motivo: body.cobrar
        ? null
        : body.motivo?.trim() || "Desativado manualmente",
      updated_at: now,
    })
    .eq("id", body.dependenteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await reconcileDependentBillingForTitular(serviceClient, dependente.titular_id, {
    userId: user.id,
    motivo: body.cobrar ? "reativação manual" : "desativação manual",
    retomadosIds: body.cobrar && wasDisabled ? [body.dependenteId] : [],
  });

  return NextResponse.json({ success: true });
}
