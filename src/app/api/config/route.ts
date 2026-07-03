import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { chave, valor } = body;

  if (!chave || !valor) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  try {
    await updateConfig(supabase, chave, valor);
    await createLog(supabase, {
      usuario_id: user.id,
      acao: "configuracao_atualizada",
      entidade: "configuracoes",
      payload: { chave },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
