import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MESSAGE_SEND_INTERVAL_MS = 3_000;
const MESSAGE_QUEUE_BATCH_LIMIT = 10;
const MESSAGE_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const REMINDER_WINDOW_START_HOUR = 8;
const REMINDER_WINDOW_END_HOUR = 12;
const REMINDER_MIN_INTERVAL_MS = 5_000;
const REMINDER_MAX_INTERVAL_MS = 120_000;
const BRAZIL_TZ = "America/Sao_Paulo";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getBrazilParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function buildBrazilDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
}

function addBrazilDays(parts: ReturnType<typeof getBrazilParts>, days: number) {
  const base = buildBrazilDate(parts.year, parts.month, parts.day, 12);
  base.setUTCDate(base.getUTCDate() + days);
  return getBrazilParts(base);
}

function getBrazilDateString(now = new Date(), offsetDays = 0) {
  const parts =
    offsetDays === 0
      ? getBrazilParts(now)
      : addBrazilDays(getBrazilParts(now), offsetDays);
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

async function getReminderWindowFromConfig(
  supabase: ReturnType<typeof createClient>
) {
  const { data } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "cron")
    .maybeSingle();
  const v = (data?.valor ?? {}) as {
    janela_inicio?: number;
    janela_inicio_minuto?: number;
    janela_fim?: number;
    janela_fim_minuto?: number;
  };
  let startHour = Number(v.janela_inicio ?? REMINDER_WINDOW_START_HOUR);
  let startMinute = Number(v.janela_inicio_minuto ?? 0);
  let endHour = Number(v.janela_fim ?? REMINDER_WINDOW_END_HOUR);
  let endMinute = Number(v.janela_fim_minuto ?? 0);
  if (!Number.isFinite(startHour)) startHour = REMINDER_WINDOW_START_HOUR;
  if (!Number.isFinite(startMinute)) startMinute = 0;
  if (!Number.isFinite(endHour)) endHour = REMINDER_WINDOW_END_HOUR;
  if (!Number.isFinite(endMinute)) endMinute = 0;
  startMinute = Math.min(59, Math.max(0, Math.round(startMinute)));
  endMinute = Math.min(59, Math.max(0, Math.round(endMinute)));
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) {
    endTotal = startTotal + 60;
    endHour = Math.floor((endTotal % (24 * 60)) / 60);
    endMinute = endTotal % 60;
  }
  return { startHour, startMinute, endHour, endMinute };
}

function computeReminderScheduleSlots(
  count: number,
  now = new Date(),
  startHour = REMINDER_WINDOW_START_HOUR,
  startMinute = 0,
  endHour = REMINDER_WINDOW_END_HOUR,
  endMinute = 0
) {
  if (count <= 0) return [];

  const today = getBrazilParts(now);
  let windowStart = buildBrazilDate(
    today.year,
    today.month,
    today.day,
    startHour,
    startMinute
  );
  let windowEnd = buildBrazilDate(
    today.year,
    today.month,
    today.day,
    endHour,
    endMinute
  );

  let effectiveStart = now > windowStart ? now : windowStart;

  if (now < windowStart) {
    effectiveStart = windowStart;
  } else if (effectiveStart >= windowEnd) {
    const tomorrow = addBrazilDays(today, 1);
    windowStart = buildBrazilDate(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      startHour,
      startMinute
    );
    windowEnd = buildBrazilDate(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      endHour,
      endMinute
    );
    effectiveStart = windowStart;
  }

  const windowMs = Math.max(windowEnd.getTime() - effectiveStart.getTime(), 60_000);
  const intervalMs = Math.max(
    REMINDER_MIN_INTERVAL_MS,
    Math.min(REMINDER_MAX_INTERVAL_MS, Math.floor(windowMs / count))
  );

  return Array.from(
    { length: count },
    (_, index) => new Date(effectiveStart.getTime() + index * intervalMs)
  );
}

function resolveSendIntervalMs(dueCount: number) {
  if (dueCount > 50) return 15_000;
  if (dueCount > 20) return 8_000;
  return MESSAGE_SEND_INTERVAL_MS;
}

function nextRetryDate(attempt: number, intervals: number[] | null | undefined) {
  const minutes = intervals?.[attempt - 1] ?? intervals?.at(-1) ?? 10;
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
}

async function getCronSecret(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "cron")
    .maybeSingle();
  const fromDb = (data?.valor as { secret?: string } | null)?.secret;
  return fromDb || Deno.env.get("CRON_SECRET") || "";
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

async function resolveBeneficioFornecido(
  supabase: ReturnType<typeof createClient>,
  beneficiarioId: string
) {
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

async function fetchPaymentTemplateVars(
  supabase: ReturnType<typeof createClient>,
  paymentId: string,
  base: {
    nome: string;
    valor: string;
    data_vencimento: string;
  }
) {
  const result = {
    ...base,
    link_fatura: "",
    codigo_pix: "",
    linha_digitavel: "",
  };

  const { data: configRow } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "asaas")
    .maybeSingle();

  const asaasConfig = configRow?.valor as
    | { api_key?: string; ambiente?: string }
    | undefined;
  if (!asaasConfig?.api_key) return result;

  const baseUrl =
    asaasConfig.ambiente === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const headers = {
    "Content-Type": "application/json",
    access_token: asaasConfig.api_key,
    "User-Agent": "TotalPassManager",
  };

  try {
    const res = await fetch(`${baseUrl}/payments/${paymentId}`, { headers });
    if (res.ok) {
      const details = await res.json();
      result.link_fatura = details.invoiceUrl || details.bankSlipUrl || "";
      result.linha_digitavel = details.identificationField || "";
    }
  } catch {
    // segue
  }

  if (!result.linha_digitavel) {
    try {
      const boletoRes = await fetch(
        `${baseUrl}/payments/${paymentId}/identificationField`,
        { headers }
      );
      if (boletoRes.ok) {
        const boleto = await boletoRes.json();
        result.linha_digitavel = boleto.identificationField ?? "";
      }
    } catch {
      // segue
    }
  }

  try {
    const pixRes = await fetch(`${baseUrl}/payments/${paymentId}/pixQrCode`, {
      headers,
    });
    if (pixRes.ok) {
      const pix = await pixRes.json();
      result.codigo_pix = pix.payload ?? "";
    }
  } catch {
    // segue
  }

  return result;
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

async function sendQueuedMessage(
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
    if (!p.codigo_pix) throw new Error("Codigo PIX ausente");
    return uazapiSend(cfg, "/send/menu", {
      number: msg.telefone,
      type: "button",
      text: msg.mensagem,
      choices: [`Copiar PIX|copy:${p.codigo_pix}`],
      footerText: "Toque no botao para copiar o PIX",
    });
  }

  if (msg.tipo_envio === "botoes_pix_boleto") {
    if (!p.codigo_pix || !p.linha_digitavel) {
      throw new Error("PIX ou linha digitavel ausente");
    }
    return uazapiSend(cfg, "/send/menu", {
      number: msg.telefone,
      type: "button",
      text: msg.mensagem,
      choices: [
        `Copiar PIX|copy:${p.codigo_pix}`,
        `Copiar boleto|copy:${p.linha_digitavel}`,
      ],
      footerText: "Toque no botao desejado",
    });
  }

  if (msg.tipo_envio === "botoes_pagamento") {
    if (!p.codigo_pix || !p.linha_digitavel || !p.link_fatura) {
      throw new Error("Dados de pagamento incompletos");
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
      footerText: "Toque no botao desejado",
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
    agendadoPara?: Date;
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
  const payloadEnvio = Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, String(value ?? "")])
  );

  const dedupeDesde = new Date(
    Date.now() - MESSAGE_DEDUPE_WINDOW_MS
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

  await supabase.from("mensagens").insert({
    beneficiario_id: params.beneficiarioId,
    telefone: normalizePhone(beneficiario.telefone),
    template_id: template.id,
    mensagem,
    tipo_envio: template.tipo_envio ?? "texto",
    payload_envio: payloadEnvio,
    max_tentativas: template.max_tentativas ?? 3,
    status: "pendente",
    tentativas: 0,
    agendado_para: (params.agendadoPara ?? new Date()).toISOString(),
  });
}

async function countDueMessages(
  supabase: ReturnType<typeof createClient>,
  now: string
) {
  const { count } = await supabase
    .from("mensagens")
    .select("*", { count: "exact", head: true })
    .in("status", ["pendente", "erro"])
    .lte("agendado_para", now)
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${now}`);
  return count ?? 0;
}

async function schedulePaymentReminders(supabase: ReturnType<typeof createClient>) {
  const { startHour, startMinute, endHour, endMinute } =
    await getReminderWindowFromConfig(supabase);
  const todayBrazil = getBrazilDateString();
  const offsets = [
    { days: 3, evento: "vencimento_3dias" },
    { days: 0, evento: "vencimento_dia" },
    { days: -1, evento: "vencimento_1dia" },
  ];

  const candidates: Array<{
    evento: string;
    beneficiarioId: string;
    vars: Record<string, string | number>;
  }> = [];

  for (const { days, evento } of offsets) {
    const dateStr = getBrazilDateString(new Date(), days);

    const { data: template } = await supabase
      .from("mensagem_templates")
      .select("id")
      .eq("evento", evento)
      .eq("ativo", true)
      .maybeSingle();
    if (!template?.id) continue;

    const { data: cobrancas } = await supabase
      .from("cobrancas")
      .select("*, beneficiario:beneficiarios(id, nome)")
      .eq("vencimento", dateStr)
      .in("status", ["PENDING", "OVERDUE"]);

    for (const c of cobrancas ?? []) {
      const beneficiario = Array.isArray(c.beneficiario)
        ? c.beneficiario[0]
        : c.beneficiario;
      if (!beneficiario?.id) continue;

      const { data: existing } = await supabase
        .from("mensagens")
        .select("id")
        .eq("beneficiario_id", beneficiario.id)
        .eq("template_id", template.id)
        .gte("created_at", `${todayBrazil}T00:00:00`)
        .maybeSingle();
      if (existing) continue;

      const baseVars = {
        nome: beneficiario.nome,
        valor: Number(c.valor).toFixed(2).replace(".", ","),
        data_vencimento: dateStr.split("-").reverse().join("/"),
      };
      const vars = c.asaas_payment_id
        ? await fetchPaymentTemplateVars(supabase, c.asaas_payment_id, baseVars)
        : {
            ...baseVars,
            link_fatura: "",
            codigo_pix: "",
            linha_digitavel: "",
          };

      candidates.push({
        evento,
        beneficiarioId: beneficiario.id,
        vars,
      });
    }
  }

  const slots = computeReminderScheduleSlots(
    candidates.length,
    new Date(),
    startHour,
    startMinute,
    endHour,
    endMinute
  );
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    await scheduleMessage(supabase, {
      evento: candidate.evento,
      beneficiarioId: candidate.beneficiarioId,
      vars: candidate.vars,
      agendadoPara: slots[index],
    });
  }

  return { scheduled: candidates.length };
}

async function reconcileMisscheduledReminders(
  supabase: ReturnType<typeof createClient>
) {
  const todayBrazil = getBrazilDateString();
  const nowIso = new Date().toISOString();
  const reminderEventos = [
    "vencimento_3dias",
    "vencimento_dia",
    "vencimento_1dia",
  ];

  const { data: templates } = await supabase
    .from("mensagem_templates")
    .select("id")
    .in("evento", reminderEventos);

  const templateIds = (templates ?? []).map((t) => t.id);
  if (templateIds.length === 0) return;

  await supabase
    .from("mensagens")
    .update({ agendado_para: nowIso })
    .eq("status", "pendente")
    .in("template_id", templateIds)
    .gte("created_at", `${todayBrazil}T00:00:00`)
    .gt("agendado_para", nowIso);
}

async function processMessageQueue(supabase: ReturnType<typeof createClient>) {
  await reconcileMisscheduledReminders(supabase);

  const now = new Date().toISOString();
  const { data: pendentes } = await supabase
    .from("mensagens")
    .select("*")
    .in("status", ["pendente", "erro"])
    .lte("agendado_para", now)
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${now}`)
    .order("created_at", { ascending: true })
    .order("agendado_para", { ascending: true })
    .limit(MESSAGE_QUEUE_BATCH_LIMIT);

  const cfg = await getUazapiConfig(supabase);
  if (!cfg.url || !cfg.token) {
    return {
      processed: 0,
      pending: await countDueMessages(supabase, now),
      error: "Uazapi nao configurado",
    };
  }

  const dueBefore = await countDueMessages(supabase, now);
  const sendIntervalMs = resolveSendIntervalMs(dueBefore);
  let processed = 0;
  const batch = pendentes ?? [];
  const shouldThrottle = batch.length >= 2;
  let sendAttempt = 0;

  for (const msg of batch) {
    if ((msg.tentativas ?? 0) >= (msg.max_tentativas ?? 3)) continue;

    const { data: claimed } = await supabase
      .from("mensagens")
      .update({ status: "enviando" })
      .eq("id", msg.id)
      .in("status", ["pendente", "erro"])
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    if (shouldThrottle && sendAttempt > 0) {
      await sleep(sendIntervalMs);
    }
    sendAttempt++;

    try {
      await sendQueuedMessage(cfg, {
        telefone: msg.telefone,
        mensagem: msg.mensagem,
        tipo_envio: msg.tipo_envio ?? "texto",
        payload_envio: (msg.payload_envio ?? {}) as Record<string, string>,
      });

      await supabase
        .from("mensagens")
        .update({
          status: "enviado",
          enviado_em: new Date().toISOString(),
          erro: null,
          proxima_tentativa_em: null,
          tentativas: (msg.tentativas ?? 0) + 1,
        })
        .eq("id", msg.id);
      processed++;
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Erro desconhecido";
      const tentativas = (msg.tentativas ?? 0) + 1;
      const maxTentativas = msg.max_tentativas ?? 3;
      const { data: template } = msg.template_id
        ? await supabase
            .from("mensagem_templates")
            .select("intervalo_retry_minutos")
            .eq("id", msg.template_id)
            .maybeSingle()
        : { data: null };

      await supabase
        .from("mensagens")
        .update({
          status: "erro",
          erro,
          tentativas,
          proxima_tentativa_em:
            tentativas < maxTentativas
              ? nextRetryDate(
                  tentativas,
                  template?.intervalo_retry_minutos as number[] | null
                )
              : null,
        })
        .eq("id", msg.id);
    }
  }

  return {
    processed,
    pending: await countDueMessages(supabase, new Date().toISOString()),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo nao permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const expectedSecret = await getCronSecret(supabase);
  const auth = req.headers.get("authorization");
  if (expectedSecret && auth !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Nao autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "schedule";

    if (action === "process") {
      const result = await processMessageQueue(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const schedule = await schedulePaymentReminders(supabase);
    return new Response(JSON.stringify(schedule), {
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
