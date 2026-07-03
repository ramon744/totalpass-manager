import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveAdmin } from "@/lib/auth-admin";
import { createLog } from "@/lib/logger";
import type { MensagemTemplate, TipoEnvioMensagem } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
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

  const body = (await request.json()) as Partial<MensagemTemplate>;

  const updatePayload = {
    corpo: body.corpo,
    titulo: body.titulo,
    ativo: body.ativo,
    tipo_envio: body.tipo_envio as TipoEnvioMensagem | undefined,
    max_tentativas: body.max_tentativas,
    intervalo_retry_minutos: body.intervalo_retry_minutos,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("mensagem_templates")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }

  await createLog(supabase, {
    usuario_id: user.id,
    acao: "template_atualizado",
    entidade: "mensagem_templates",
    entidade_id: id,
    payload: { evento: data.evento, ativo: data.ativo },
  });

  return NextResponse.json({ template: data });
}
