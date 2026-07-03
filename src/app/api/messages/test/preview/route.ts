import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/uazapi/client";
import { TEMPLATE_SAMPLE_VARS } from "@/lib/message-templates";
import { buildTemplateVarsForBeneficiario } from "@/lib/services/template-vars";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { beneficiarioId, templateId } = body;

  if (!templateId) {
    return NextResponse.json({ error: "Template obrigatório" }, { status: 400 });
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  const { data: template } = await serviceClient
    .from("mensagem_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (!template) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }

  try {
    if (beneficiarioId) {
      const result = await buildTemplateVarsForBeneficiario(
        serviceClient,
        beneficiarioId,
        template.evento
      );

      return NextResponse.json({
        preview: renderTemplate(template.corpo, result.vars),
        vars: result.vars,
        telefone: result.telefone,
        temAssinatura: result.temAssinatura,
        temCobrancaPendente: result.temCobrancaPendente,
        usandoDadosReais: true,
      });
    }

    return NextResponse.json({
      preview: renderTemplate(template.corpo, TEMPLATE_SAMPLE_VARS),
      vars: TEMPLATE_SAMPLE_VARS,
      telefone: null,
      temAssinatura: false,
      temCobrancaPendente: false,
      usandoDadosReais: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao gerar prévia" },
      { status: 400 }
    );
  }
}
