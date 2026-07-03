import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, asaas-access-token",
};

function mapPaymentStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: "PENDING",
    RECEIVED: "RECEIVED",
    CONFIRMED: "CONFIRMED",
    OVERDUE: "OVERDUE",
    REFUNDED: "REFUNDED",
    DELETED: "DELETED",
  };
  return map[status] ?? status;
}

function normalizeSubscriptionStatus(status: string): string {
  const s = (status ?? "").toUpperCase();
  return s === "ACTIVE" ? "ACTIVE" : "CANCELLED";
}

const BRAZIL_TZ = "America/Sao_Paulo";

function getBrazilDateString(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

function daysBetweenBrazilDates(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T12:00:00-03:00`);
  const to = new Date(`${toYmd}T12:00:00-03:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function resolveCatchUpReminderEvent(
  vencimentoYmd: string,
  todayYmd = getBrazilDateString()
): string | null {
  const diffDays = daysBetweenBrazilDates(todayYmd, vencimentoYmd);

  if (diffDays > 3) return null;
  if (diffDays === 3) return "vencimento_3dias";
  if (diffDays === 1 || diffDays === 2) return null;
  if (diffDays === 0) return "vencimento_dia";
  if (diffDays === -1) return "vencimento_1dia";
  if (diffDays >= -6 && diffDays <= -2) return null;
  if (diffDays <= -7) return "vencimento_7dias";
  return null;
}

async function scheduleCatchUpPaymentReminder(
  supabase: ReturnType<typeof createClient>,
  params: {
    beneficiarioId: string;
    vencimento: string;
    status: string;
    payment: {
      id: string;
      value: number | string;
      dueDate: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
      identificationField?: string;
    };
    nome: string;
  }
) {
  if (params.status !== "PENDING" && params.status !== "OVERDUE") return;

  const evento = resolveCatchUpReminderEvent(params.vencimento);
  if (!evento) return;

  const vars = await fetchPaymentTemplateVars(
    supabase,
    params.payment,
    params.nome
  );

  await scheduleMessage(supabase, {
    evento,
    beneficiarioId: params.beneficiarioId,
    vars,
    asaasPaymentId: params.payment.id,
  });
}

async function fetchPaymentTemplateVars(
  supabase: ReturnType<typeof createClient>,
  payment: {
    id: string;
    value: number | string;
    dueDate: string;
    invoiceUrl?: string;
    bankSlipUrl?: string;
    identificationField?: string;
  },
  nome: string
) {
  const base = {
    nome,
    valor: Number(payment.value).toFixed(2).replace(".", ","),
    data_vencimento: String(payment.dueDate).split("-").reverse().join("/"),
    link_fatura: payment.invoiceUrl ?? payment.bankSlipUrl ?? "",
    linha_digitavel: payment.identificationField ?? "",
    codigo_pix: "",
  };

  const { data: configRow } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "asaas")
    .maybeSingle();

  const asaasConfig = configRow?.valor as
    | { api_key?: string; ambiente?: string }
    | undefined;

  if (!asaasConfig?.api_key) return base;

  const baseUrl =
    asaasConfig.ambiente === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";

  const headers = {
    "Content-Type": "application/json",
    access_token: asaasConfig.api_key,
    "User-Agent": "TotalPassManager",
  };

  if (!base.link_fatura || !base.linha_digitavel) {
    try {
      const res = await fetch(`${baseUrl}/payments/${payment.id}`, { headers });
      if (res.ok) {
        const details = await res.json();
        base.link_fatura =
          base.link_fatura || details.invoiceUrl || details.bankSlipUrl || "";
        base.linha_digitavel =
          base.linha_digitavel || details.identificationField || "";
      }
    } catch {
      // Mantém dados do webhook.
    }
  }

  if (!base.linha_digitavel) {
    try {
      const boletoRes = await fetch(
        `${baseUrl}/payments/${payment.id}/identificationField`,
        { headers }
      );
      if (boletoRes.ok) {
        const boleto = await boletoRes.json();
        base.linha_digitavel = boleto.identificationField ?? "";
      }
    } catch {
      // Cobrança pode não ter boleto habilitado.
    }
  }

  try {
    const pixRes = await fetch(`${baseUrl}/payments/${payment.id}/pixQrCode`, {
      headers,
    });
    if (pixRes.ok) {
      const pix = await pixRes.json();
      base.codigo_pix = pix.payload ?? "";
    }
  } catch {
    // Cobrança pode ser boleto.
  }

  return base;
}

function renderTemplate(
  template: string,
  vars: Record<string, string | number>
) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(vars[key] ?? "")
  );
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function resolveBeneficioFornecido(
  supabase: ReturnType<typeof createClient>,
  beneficiarioId: string
): Promise<string> {
  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("provedor_id, titular_id")
    .eq("id", beneficiarioId)
    .maybeSingle();

  if (!beneficiario) return "";

  let provedorId = beneficiario.provedor_id;

  if (!provedorId && beneficiario.titular_id) {
    const { data: titular } = await supabase
      .from("beneficiarios")
      .select("provedor_id")
      .eq("id", beneficiario.titular_id)
      .maybeSingle();
    provedorId = titular?.provedor_id ?? null;
  }

  if (!provedorId) return "";

  const { data: provedor } = await supabase
    .from("provedores")
    .select("beneficio")
    .eq("id", provedorId)
    .maybeSingle();

  return provedor?.beneficio?.trim() ?? "";
}

async function getUazapiConfig(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "uazapi")
    .maybeSingle();
  const c = (data?.valor ?? {}) as { url?: string; token?: string };
  return {
    url: c.url || Deno.env.get("UAZAPI_URL") || "",
    token: c.token || Deno.env.get("UAZAPI_TOKEN") || "",
  };
}

async function uazapiSend(
  cfg: { url: string; token: string },
  path: string,
  body: Record<string, unknown>
) {
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: cfg.token },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? "Erro ao enviar WhatsApp");
  }
  return data;
}

async function sendMessageNow(
  cfg: { url: string; token: string },
  msg: {
    telefone: string;
    mensagem: string;
    tipo_envio: string;
    payload_envio: Record<string, string>;
  }
) {
  const p = msg.payload_envio ?? {};

  if (msg.tipo_envio === "botao_pix") {
    if (!p.codigo_pix) throw new Error("Código PIX ausente para botão");
    return uazapiSend(cfg, "/send/menu", {
      number: msg.telefone,
      type: "button",
      text: msg.mensagem,
      choices: [`Copiar PIX|copy:${p.codigo_pix}`],
      footerText: "Toque no botão para copiar o PIX",
    });
  }

  if (msg.tipo_envio === "botoes_pix_boleto") {
    if (!p.codigo_pix || !p.linha_digitavel) {
      throw new Error("PIX ou linha digitável ausente para botões");
    }
    return uazapiSend(cfg, "/send/menu", {
      number: msg.telefone,
      type: "button",
      text: msg.mensagem,
      choices: [
        `Copiar PIX|copy:${p.codigo_pix}`,
        `Copiar boleto|copy:${p.linha_digitavel}`,
      ],
      footerText: "Toque no botão desejado",
    });
  }

  if (msg.tipo_envio === "botoes_pagamento") {
    if (!p.codigo_pix || !p.linha_digitavel || !p.link_fatura) {
      throw new Error("PIX, linha digitável ou link da fatura ausente para botões");
    }
    return uazapiSend(cfg, "/send/menu", {
      number: msg.telefone,
      type: "button",
      text: msg.mensagem,
      choices: [
        `Copiar PIX|copy:${p.codigo_pix}`,
        `Copiar boleto|copy:${p.linha_digitavel}`,
        `Abrir fatura|${p.link_fatura}`,
      ],
      footerText: "Toque no botão desejado",
    });
  }

  return uazapiSend(cfg, "/send/text", {
    number: msg.telefone,
    text: msg.mensagem,
  });
}

async function scheduleMessage(
  supabase: ReturnType<typeof createClient>,
  params: {
    evento: string;
    beneficiarioId: string;
    vars: Record<string, string | number>;
    asaasPaymentId?: string | null;
    refId?: string | null;
  }
) {
  const { data: template } = await supabase
    .from("mensagem_templates")
    .select("*")
    .eq("evento", params.evento)
    .eq("ativo", true)
    .maybeSingle();

  if (!template) return;

  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("telefone, nome")
    .eq("id", params.beneficiarioId)
    .single();

  if (!beneficiario?.telefone) return;

  const beneficioFornecido = await resolveBeneficioFornecido(
    supabase,
    params.beneficiarioId
  );

  const vars = {
    nome: beneficiario.nome,
    beneficio_fornecido: beneficioFornecido,
    ...params.vars,
  };
  const mensagem = renderTemplate(template.corpo, vars);
  const dedupeRef = params.asaasPaymentId ?? params.refId ?? null;
  const payloadEnvio = {
    ...Object.fromEntries(
      Object.entries(vars).map(([key, value]) => [key, String(value ?? "")])
    ),
    ...(dedupeRef ? { ref_id: dedupeRef } : {}),
  };
  const telefone = normalizePhone(beneficiario.telefone);
  const tipoEnvio = template.tipo_envio ?? "texto";

  if (dedupeRef) {
    const { data: jaExiste } = await supabase
      .from("mensagens")
      .select("id")
      .eq("beneficiario_id", params.beneficiarioId)
      .eq("template_id", template.id)
      .eq("payload_envio->>ref_id", dedupeRef)
      .in("status", ["pendente", "enviando", "enviado"])
      .limit(1)
      .maybeSingle();
    if (jaExiste) return;
  } else {
    const dedupeDesde = new Date(
      Date.now() - 12 * 60 * 60 * 1000
    ).toISOString();
    const { data: jaExiste } = await supabase
      .from("mensagens")
      .select("id")
      .eq("beneficiario_id", params.beneficiarioId)
      .eq("template_id", template.id)
      .eq("mensagem", mensagem)
      .in("status", ["pendente", "enviando", "enviado"])
      .gte("created_at", dedupeDesde)
      .limit(1)
      .maybeSingle();
    if (jaExiste) return;
  }

  // Insere já como "enviando" para que o processador da fila (cron) não
  // dispare a mesma mensagem em paralelo enquanto o envio imediato ocorre.
  const { data: inserted } = await supabase
    .from("mensagens")
    .insert({
      beneficiario_id: params.beneficiarioId,
      telefone,
      template_id: template.id,
      mensagem,
      tipo_envio: tipoEnvio,
      payload_envio: payloadEnvio,
      max_tentativas: template.max_tentativas ?? 3,
      status: "enviando",
      tentativas: 0,
      agendado_para: new Date().toISOString(),
    })
    .select("id")
    .single();

  // Envia imediatamente (o webhook não depende de cron para notificar).
  try {
    const cfg = await getUazapiConfig(supabase);
    if (!cfg.url || !cfg.token) {
      // Sem Uazapi: devolve para a fila para o cron processar depois.
      if (inserted?.id) {
        await supabase
          .from("mensagens")
          .update({ status: "pendente" })
          .eq("id", inserted.id);
      }
      return;
    }

    await sendMessageNow(cfg, {
      telefone,
      mensagem,
      tipo_envio: tipoEnvio,
      payload_envio: payloadEnvio,
    });

    if (inserted?.id) {
      await supabase
        .from("mensagens")
        .update({
          status: "enviado",
          enviado_em: new Date().toISOString(),
          erro: null,
          tentativas: 1,
        })
        .eq("id", inserted.id);
    }
  } catch (e) {
    if (inserted?.id) {
      await supabase
        .from("mensagens")
        .update({
          status: "erro",
          erro: e instanceof Error ? e.message : "Erro ao enviar",
          tentativas: 1,
        })
        .eq("id", inserted.id);
    }
  }
}

async function createLog(
  supabase: ReturnType<typeof createClient>,
  entry: {
    acao: string;
    entidade?: string;
    payload?: Record<string, unknown>;
  }
) {
  await supabase.from("logs").insert({
    acao: entry.acao,
    entidade: entry.entidade ?? null,
    payload: entry.payload ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const token = req.headers.get("asaas-access-token");
  const { data: configRow } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "asaas")
    .single();

  const webhookToken =
    (configRow?.valor as { webhook_token?: string })?.webhook_token ??
    Deno.env.get("ASAAS_WEBHOOK_TOKEN");

  if (webhookToken && token !== webhookToken) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const event = body.event as string;
    const payment = body.payment;
    const subscription = body.subscription;

    if (payment) {
      const status = mapPaymentStatus(payment.status);
      const { data: beneficiario } = await supabase
        .from("beneficiarios")
        .select("id, nome")
        .eq("asaas_customer_id", payment.customer)
        .maybeSingle();

      if (beneficiario) {
        let assinaturaId: string | null = null;
        if (payment.subscription) {
          const { data: assinatura } = await supabase
            .from("assinaturas")
            .select("id")
            .eq("asaas_subscription_id", payment.subscription)
            .maybeSingle();
          assinaturaId = assinatura?.id ?? null;
        }

        const { data: existing } = await supabase
          .from("cobrancas")
          .select("id")
          .eq("asaas_payment_id", payment.id)
          .maybeSingle();

        const payload = {
          beneficiario_id: beneficiario.id,
          assinatura_id: assinaturaId,
          valor: payment.value,
          vencimento: payment.dueDate,
          data_pagamento: payment.paymentDate ?? null,
          status,
          updated_at: new Date().toISOString(),
        };

        if (existing) {
          await supabase.from("cobrancas").update(payload).eq("id", existing.id);
        } else {
          await supabase.from("cobrancas").insert({
            ...payload,
            asaas_payment_id: payment.id,
          });

          await scheduleCatchUpPaymentReminder(supabase, {
            beneficiarioId: beneficiario.id,
            vencimento: payment.dueDate,
            status,
            payment,
            nome: beneficiario.nome,
          });
        }

        if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
          await scheduleMessage(supabase, {
            evento: "pagamento_confirmado",
            beneficiarioId: beneficiario.id,
            vars: {
              nome: beneficiario.nome,
              valor: Number(payment.value).toFixed(2).replace(".", ","),
            },
          });
        }

        if (event === "PAYMENT_OVERDUE") {
          await createLog(supabase, {
            acao: "cobranca_vencida",
            entidade: "cobrancas",
            payload: { payment_id: payment.id },
          });
        }

        if (event === "PAYMENT_CREATED" || event === "PAYMENT_PENDING") {
          const vars = await fetchPaymentTemplateVars(
            supabase,
            payment,
            beneficiario.nome
          );

          await scheduleMessage(supabase, {
            evento: "cobranca_gerada",
            beneficiarioId: beneficiario.id,
            vars,
            asaasPaymentId: payment.id,
          });
        }
      }
    }

    if (subscription) {
      const status =
        event === "SUBSCRIPTION_DELETED"
          ? "CANCELLED"
          : normalizeSubscriptionStatus(subscription.status);

      const { data: assinatura } = await supabase
        .from("assinaturas")
        .select("id, beneficiario_id")
        .eq("asaas_subscription_id", subscription.id)
        .maybeSingle();

      if (assinatura) {
        const updatePayload: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
        };
        if (subscription.value != null) updatePayload.valor = Number(subscription.value);
        if (subscription.nextDueDate) {
          updatePayload.proximo_vencimento = subscription.nextDueDate;
          const dia = Number(String(subscription.nextDueDate).split("-")[2]);
          if (dia >= 1 && dia <= 28) updatePayload.dia_vencimento = dia;
        }
        if (subscription.description?.trim()) {
          updatePayload.descricao = subscription.description.trim();
        }

        await supabase.from("assinaturas").update(updatePayload).eq("id", assinatura.id);

        if (status === "CANCELLED") {
          await scheduleMessage(supabase, {
            evento: "assinatura_cancelada",
            beneficiarioId: assinatura.beneficiario_id,
            vars: {},
            refId: assinatura.id,
          });
        }
      } else if (status === "ACTIVE") {
        let beneficiario: { id: string; asaas_customer_id: string | null } | null = null;

        const { data: byCustomer } = await supabase
          .from("beneficiarios")
          .select("id, asaas_customer_id")
          .eq("asaas_customer_id", subscription.customer)
          .eq("perfil", "titular")
          .not("provedor_id", "is", null)
          .maybeSingle();

        beneficiario = byCustomer;

        if (!beneficiario && subscription.externalReference) {
          const { data: byRef } = await supabase
            .from("beneficiarios")
            .select("id, asaas_customer_id")
            .eq("id", subscription.externalReference)
            .eq("perfil", "titular")
            .not("provedor_id", "is", null)
            .maybeSingle();

          if (byRef) {
            beneficiario = byRef;
            if (!byRef.asaas_customer_id) {
              await supabase
                .from("beneficiarios")
                .update({
                  asaas_customer_id: subscription.customer,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", byRef.id);
            }
          }
        }

        if (beneficiario) {
          const valor = Number(subscription.value) || 0;
          const diaVencimento = subscription.nextDueDate
            ? Number(String(subscription.nextDueDate).split("-")[2])
            : 10;

          await supabase.from("assinaturas").insert({
            beneficiario_id: beneficiario.id,
            asaas_subscription_id: subscription.id,
            valor: valor > 0 ? valor : 0,
            dia_vencimento: diaVencimento >= 1 && diaVencimento <= 28 ? diaVencimento : 10,
            proximo_vencimento: subscription.nextDueDate ?? null,
            descricao: subscription.description?.trim() || "Assinatura Asaas",
            status: "ACTIVE",
            data_criacao: new Date().toISOString(),
          });

          await createLog(supabase, {
            acao: "assinatura_importada_asaas",
            entidade: "assinaturas",
            payload: {
              evento: event,
              asaas_subscription_id: subscription.id,
              beneficiario_id: beneficiario.id,
            },
          });
        }
      }
    }

    await createLog(supabase, {
      acao: `webhook_${event}`,
      entidade: "asaas",
      payload: { payment, subscription },
    });

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro interno";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
