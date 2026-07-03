import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { deleteBeneficiarios } from "@/lib/services/beneficiarios";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { ids, notificarCancelamento } = body as {
    ids?: string[];
    notificarCancelamento?: boolean;
  };

  if (!ids?.length) {
    return NextResponse.json({ error: "Nenhum beneficiário selecionado" }, { status: 400 });
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    const results = await deleteBeneficiarios(serviceClient, ids, user.id, {
      notificarCancelamento: notificarCancelamento === true,
    });
    const sucesso = results.filter((r) => r.success).length;
    const erros = results.filter((r) => !r.success);
    return NextResponse.json({ results, sucesso, erros: erros.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao excluir" },
      { status: 400 }
    );
  }
}
