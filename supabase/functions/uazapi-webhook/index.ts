import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-uazapi-webhook-token, x-webhook-token, token",
};

const DEFAULT_UAZAPI_WEBHOOK_TOKEN = "tp_uaz_wh_2026_K9mN2pQ7vR4sT8wX1zB5";
const DEFAULT_ETIQUETAS_MONITORADAS = ["cliente totalpass", "cliente gympass"];

type UazapiConfig = {
  url?: string;
  token?: string;
  webhook_token?: string;
  etiquetas_monitoradas?: string[];
};

function extractWebhookToken(req: Request) {
  const url = new URL(req.url);
  return (
    url.searchParams.get("token") ||
    req.headers.get("x-uazapi-webhook-token") ||
    req.headers.get("x-webhook-token") ||
    req.headers.get("token")
  );
}

function pickEventName(body: Record<string, unknown>) {
  const raw =
    body.event ??
    body.type ??
    body.action ??
    body.EventType ??
    body.eventType;
  return raw != null ? String(raw) : "unknown";
}

function sanitizePayload(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  if (json.length <= 8000) return body;
  return {
    truncated: true,
    preview: json.slice(0, 8000),
  };
}

function normalizeLabelName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function normalizeCpf(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 ? digits : null;
}

function extractPhoneFromChat(chat: Record<string, unknown>) {
  const phoneRaw = String(chat.phone ?? chat.wa_contactName ?? "");
  const chatId = String(chat.wa_chatid ?? "");
  const fromChatId = chatId.split("@")[0]?.replace(/\D/g, "") ?? "";
  return normalizePhone(phoneRaw) ?? normalizePhone(fromChatId);
}

function parseNotes(notes: string | null | undefined) {
  const text = notes?.trim() ?? "";
  if (!text) return { cpf: null as string | null, email: null as string | null };

  const cpfMatch = text.match(/CPF:\s*([0-9.\-/]+)/i);
  const emailMatch = text.match(/E-?MAIL:\s*([^\n\r]+)/i);

  return {
    cpf: normalizeCpf(cpfMatch?.[1]),
    email: emailMatch?.[1]?.trim().toLowerCase() ?? null,
  };
}

function extractChat(body: Record<string, unknown>) {
  const chat = body.chat;
  if (chat && typeof chat === "object" && !Array.isArray(chat)) {
    return chat as Record<string, unknown>;
  }
  return null;
}

function extractLabelIds(chat: Record<string, unknown>) {
  const raw = chat.wa_label ?? chat.labels ?? chat.wa_labels;
  if (!Array.isArray(raw)) return [] as string[];
  return raw.map((item) => String(item)).filter(Boolean);
}

function extractLabelName(row: Record<string, unknown>) {
  return String(row.name ?? row.label ?? row.title ?? row.text ?? "").trim();
}

function extractLabelKeys(row: Record<string, unknown>) {
  const keys = new Set<string>();
  for (const field of ["id", "labelid", "labelId", "label_id", "_id"]) {
    const value = row[field];
    if (value != null && String(value).trim()) keys.add(String(value).trim());
  }
  return [...keys];
}

async function fetchUazapiLabels(cfg: { url: string; token: string }) {
  if (!cfg.url || !cfg.token) return [] as Record<string, unknown>[];

  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/labels`, {
      headers: { token: cfg.token },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (Array.isArray((data as { labels?: unknown }).labels)) {
      return (data as { labels: Record<string, unknown>[] }).labels;
    }
    if (Array.isArray((data as { data?: unknown }).data)) {
      return (data as { data: Record<string, unknown>[] }).data;
    }
  } catch {
    // Segue sem resolver nomes das etiquetas.
  }
  return [];
}

function resolveMonitoredLabels(
  waLabelIds: string[],
  allLabels: Record<string, unknown>[],
  monitoredNames: string[]
) {
  const monitoredNorm = monitoredNames.map(normalizeLabelName).filter(Boolean);
  const idToName = new Map<string, string>();

  for (const row of allLabels) {
    const name = extractLabelName(row);
    if (!name) continue;
    for (const key of extractLabelKeys(row)) {
      idToName.set(key, name);
    }
  }

  const matchedIds: string[] = [];
  const matchedNames: string[] = [];

  for (const waLabelId of waLabelIds) {
    const suffix = waLabelId.includes(":")
      ? waLabelId.split(":").pop() ?? waLabelId
      : waLabelId;

    let name =
      idToName.get(waLabelId) ??
      idToName.get(suffix) ??
      "";

    if (!name) {
      for (const [key, labelName] of idToName.entries()) {
        if (key === suffix || waLabelId.endsWith(`:${key}`)) {
          name = labelName;
          break;
        }
      }
    }

    const nameNorm = normalizeLabelName(name);
    let isMonitored =
      monitoredNorm.length === 0 ||
      (nameNorm &&
        monitoredNorm.some(
          (monitored) =>
            nameNorm === monitored ||
            nameNorm.includes(monitored) ||
            monitored.includes(nameNorm)
        ));

    // Se a API /labels falhar, confia no evento (operador usa só etiquetas monitoradas).
    if (!isMonitored && !name && allLabels.length === 0 && waLabelIds.length > 0) {
      isMonitored = true;
    }

    if (isMonitored) {
      matchedIds.push(waLabelId);
      matchedNames.push(name || `Etiqueta ${suffix}`);
    }
  }

  return { matchedIds, matchedNames };
}

async function createLog(
  supabase: ReturnType<typeof createClient>,
  entry: {
    acao: string;
    entidade?: string;
    payload?: Record<string, unknown>;
    ip?: string;
  }
) {
  await supabase.from("logs").insert({
    acao: entry.acao,
    entidade: entry.entidade ?? null,
    payload: entry.payload ?? null,
    ip: entry.ip ?? null,
  });
}

async function findBeneficiarioIdByCpf(
  supabase: ReturnType<typeof createClient>,
  cpf: string | null
) {
  if (!cpf) return null;
  const { data } = await supabase
    .from("beneficiarios")
    .select("id")
    .eq("cpf", cpf)
    .maybeSingle();
  return data?.id ?? null;
}

async function processChatLabels(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  uazapiConfig: UazapiConfig
) {
  const chat = extractChat(body);
  if (!chat) {
    return { action: "skipped", reason: "chat_ausente" };
  }

  const chatId = String(chat.id ?? chat.wa_chatid ?? "").trim();
  if (!chatId) {
    return { action: "skipped", reason: "chat_id_ausente" };
  }

  const telefone = extractPhoneFromChat(chat);
  if (!telefone) {
    return { action: "skipped", reason: "telefone_ausente" };
  }

  const waLabelIds = extractLabelIds(chat);
  const monitoredNames =
    uazapiConfig.etiquetas_monitoradas?.length
      ? uazapiConfig.etiquetas_monitoradas
      : DEFAULT_ETIQUETAS_MONITORADAS;

  const uazapiUrl = uazapiConfig.url || Deno.env.get("UAZAPI_URL") || "";
  const uazapiToken = uazapiConfig.token || Deno.env.get("UAZAPI_TOKEN") || "";
  const allLabels = await fetchUazapiLabels({ url: uazapiUrl, token: uazapiToken });
  const { matchedIds, matchedNames } = resolveMonitoredLabels(
    waLabelIds,
    allLabels,
    monitoredNames
  );

  if (matchedIds.length === 0) {
    const { data: deletedRows } = await supabase
      .from("pre_cadastros_whatsapp")
      .delete()
      .eq("uazapi_chat_id", chatId)
      .select("id");

    return {
      action: "deleted",
      count: deletedRows?.length ?? 0,
      chat_id: chatId,
    };
  }

  const notes = String(chat.wa_notes ?? chat.lead_notes ?? "");
  const parsed = parseNotes(notes);
  const nome =
    String(chat.lead_fullName ?? chat.wa_name ?? chat.name ?? "").trim() || null;
  const beneficiarioId = await findBeneficiarioIdByCpf(supabase, parsed.cpf);
  const now = new Date().toISOString();

  const payload = {
    uazapi_chat_id: chatId,
    telefone,
    nome,
    cpf: parsed.cpf,
    email: parsed.email,
    etiquetas: matchedNames,
    etiqueta_ids: matchedIds,
    wa_notes: notes || null,
    data_etiqueta: now,
    beneficiario_id: beneficiarioId,
    updated_at: now,
  };

  const { data: existing } = await supabase
    .from("pre_cadastros_whatsapp")
    .select("id")
    .eq("uazapi_chat_id", chatId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("pre_cadastros_whatsapp")
      .update(payload)
      .eq("id", existing.id);

    return {
      action: "updated",
      id: existing.id,
      chat_id: chatId,
      etiquetas: matchedNames,
    };
  }

  const { data: inserted } = await supabase
    .from("pre_cadastros_whatsapp")
    .insert(payload)
    .select("id")
    .single();

  return {
    action: "created",
    id: inserted?.id,
    chat_id: chatId,
    etiquetas: matchedNames,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, service: "totalpass-manager-uazapi-webhook" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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

  const { data: configRow } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "uazapi")
    .maybeSingle();

  const uazapiConfig = (configRow?.valor ?? {}) as UazapiConfig;

  const expectedToken =
    uazapiConfig.webhook_token ??
    Deno.env.get("UAZAPI_WEBHOOK_TOKEN") ??
    DEFAULT_UAZAPI_WEBHOOK_TOKEN;

  const receivedToken = extractWebhookToken(req);

  if (expectedToken && receivedToken !== expectedToken) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const evento = pickEventName(body);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined;

    let preCadastro: Record<string, unknown> | null = null;

    if (evento.toLowerCase() === "chat_labels") {
      preCadastro = await processChatLabels(supabase, body, uazapiConfig);
    }

    await createLog(supabase, {
      acao: "uazapi_webhook_recebido",
      entidade: "uazapi_webhook",
      payload: {
        evento,
        pre_cadastro: preCadastro,
        body: sanitizePayload(body),
      },
      ip,
    });

    return new Response(
      JSON.stringify({ received: true, evento, pre_cadastro: preCadastro }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro interno";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
