import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUazapiConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import { UazapiClient, renderTemplate } from "@/lib/uazapi/client";
import {
  describeTesteEnvio,
  type TesteEnvioTipo,
} from "@/lib/uazapi/test-send";
import { TEMPLATE_SAMPLE_VARS } from "@/lib/message-templates";
import { buildTemplateVarsForBeneficiario } from "@/lib/services/template-vars";
import { normalizePhone, maskPhoneInput } from "@/lib/utils";
import { isValidPhone } from "@/lib/validators/phone";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const { telefone, mensagem, templateId, beneficiarioId, tipoEnvioTeste } = body;
  const tipoEnvio = (tipoEnvioTeste ?? "texto") as TesteEnvioTipo;

  const uazapiConfig = await getUazapiConfig(supabase);
  if (!uazapiConfig?.url || !uazapiConfig?.token) {
    return NextResponse.json(
      { error: "Uazapi não configurada. Vá em Configurações." },
      { status: 400 }
    );
  }

  let texto = mensagem?.trim() ?? "";
  let template_id: string | null = null;
  let phoneInput = telefone?.trim() ?? "";
  let codigoPix = "";
  let linhaDigitavel = "";
  let linkFatura = "";

  if (templateId) {
    const { data: template, error: templateError } = await supabase
      .from("mensagem_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle();

    if (templateError) {
      return NextResponse.json({ error: templateError.message }, { status: 400 });
    }

    if (!template) {
      return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
    }

    template_id = template.id;

    if (beneficiarioId) {
      const result = await buildTemplateVarsForBeneficiario(
        supabase,
        beneficiarioId,
        template.evento
      );
      texto = renderTemplate(template.corpo, result.vars);
      codigoPix = result.vars.codigo_pix ?? "";
      linhaDigitavel = result.vars.linha_digitavel ?? "";
      linkFatura =
        result.vars.link_fatura || result.vars.link_pagamento || "";
      if (!phoneInput && result.telefone) {
        phoneInput = maskPhoneInput(result.telefone);
      }
    } else {
      texto = renderTemplate(template.corpo, TEMPLATE_SAMPLE_VARS);
      codigoPix = TEMPLATE_SAMPLE_VARS.codigo_pix;
      linhaDigitavel = TEMPLATE_SAMPLE_VARS.linha_digitavel;
      linkFatura =
        TEMPLATE_SAMPLE_VARS.link_fatura ||
        TEMPLATE_SAMPLE_VARS.link_pagamento ||
        "";
    }
  }

  if (!phoneInput) {
    return NextResponse.json(
      { error: "Informe o telefone ou selecione um cliente com WhatsApp cadastrado" },
      { status: 400 }
    );
  }

  if (!isValidPhone(phoneInput)) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  if (!texto) {
    return NextResponse.json(
      { error: "Informe a mensagem ou selecione um template" },
      { status: 400 }
    );
  }

  if (tipoEnvio === "botao_pix" && !codigoPix) {
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar o botão: este template/cliente não possui código PIX.",
      },
      { status: 400 }
    );
  }

  if (tipoEnvio === "botao_link" && !linkFatura) {
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar o botão: este template/cliente não possui link de pagamento.",
      },
      { status: 400 }
    );
  }

  if (tipoEnvio === "botoes_pix_boleto" && (!codigoPix || !linhaDigitavel)) {
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar os botões: é necessário PIX e linha digitável do boleto.",
      },
      { status: 400 }
    );
  }

  if (
    tipoEnvio === "botoes_pagamento" &&
    (!codigoPix || !linhaDigitavel || !linkFatura)
  ) {
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar os botões: é necessário PIX, linha digitável e link da fatura.",
      },
      { status: 400 }
    );
  }

  const phone = normalizePhone(phoneInput);
  const mensagemRegistro = describeTesteEnvio(tipoEnvio, texto);

  try {
    const client = new UazapiClient(uazapiConfig);
    if (tipoEnvio === "botao_pix") {
      await client.sendCopyButton(phone, texto, codigoPix);
    } else if (tipoEnvio === "botao_link") {
      await client.sendLinkButton(phone, texto, linkFatura);
    } else if (tipoEnvio === "botoes_pix_boleto") {
      await client.sendPaymentCopyButtons(phone, texto, {
        codigoPix,
        linhaDigitavel,
      });
    } else if (tipoEnvio === "botoes_pagamento") {
      await client.sendPaymentActionButtons(phone, texto, {
        codigoPix,
        linhaDigitavel,
        linkFatura,
      });
    } else {
      await client.sendText(phone, texto);
    }

    const { data: registro } = await supabase
      .from("mensagens")
      .insert({
        beneficiario_id: beneficiarioId || null,
        telefone: phone,
        template_id,
        mensagem: mensagemRegistro,
        status: "enviado",
        tentativas: 1,
        enviado_em: new Date().toISOString(),
      })
      .select()
      .single();

    await createLog(supabase, {
      usuario_id: user.id,
      acao: "whatsapp_teste_enviado",
      entidade: "mensagens",
      entidade_id: registro?.id,
      payload: {
        telefone: phone,
        beneficiario_id: beneficiarioId ?? null,
        tipo_envio: tipoEnvio,
      },
    });

    return NextResponse.json({
      success: true,
      mensagem: texto,
      telefone: phone,
      tipo_envio: tipoEnvio,
    });
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro ao enviar";

    await supabase.from("mensagens").insert({
      beneficiario_id: beneficiarioId || null,
      telefone: phone,
      template_id,
      mensagem: mensagemRegistro,
      status: "erro",
      erro,
      tentativas: 1,
    });

    await createLog(supabase, {
      usuario_id: user.id,
      acao: "whatsapp_teste_erro",
      payload: {
        telefone: phone,
        erro,
        beneficiario_id: beneficiarioId ?? null,
        tipo_envio: tipoEnvio,
      },
    });

    return NextResponse.json({ error: erro }, { status: 400 });
  }
}
