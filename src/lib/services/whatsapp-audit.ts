import type { SupabaseClient } from "@supabase/supabase-js";
import { UazapiClient } from "@/lib/uazapi/client";
import { getUazapiConfig } from "@/lib/config";
import {
  DEFAULT_ETIQUETAS_MONITORADAS,
  type Beneficiario,
} from "@/types/database";

export type WhatsappAuditGrupo = "bate" | "so_whatsapp" | "so_manager";

export type WhatsappAuditEtiquetaTipo = "totalpass" | "gympass" | "outra";

export interface WhatsappAuditItem {
  grupo: WhatsappAuditGrupo;
  /** Etiquetas de interesse encontradas no chat (ex.: Cliente TotalPass + CANCELADO). */
  etiquetas: string[];
  tipos: WhatsappAuditEtiquetaTipo[];
  tem_cancelado: boolean;
  wa_nome: string | null;
  /** Telefone real (vazio se WhatsApp só expõe LID). */
  wa_telefone: string;
  /** true quando o chat é LID / privacidade — não há celular utilizável. */
  telefone_oculto: boolean;
  wa_chat_id: string | null;
  beneficiario_id: string | null;
  beneficiario_nome: string | null;
  beneficiario_cpf: string | null;
  beneficiario_telefone: string | null;
  beneficiario_perfil: string | null;
  beneficiario_status: string | null;
}

export interface WhatsappAuditResult {
  ok: true;
  gerado_em: string;
  chats_analisados: number;
  etiquetas_alvo: string[];
  resumo: {
    bate: number;
    so_whatsapp: number;
    so_manager: number;
    totalpass_wa: number;
    gympass_wa: number;
    totalpass_com_cancelado: number;
  };
  itens: WhatsappAuditItem[];
}

function normalizeLabelName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

/** Variantes BR (com/sem 55, com/sem 9º dígito) para cruzar Manager ↔ WhatsApp. */
export function phoneMatchKeys(value: string | null | undefined): string[] {
  const raw = digitsOnly(value);
  if (!raw) return [];

  const keys = new Set<string>();
  keys.add(raw);

  let local = raw;
  if (raw.startsWith("55") && raw.length >= 12) {
    local = raw.slice(2);
    keys.add(local);
  } else if (raw.length === 10 || raw.length === 11) {
    keys.add(`55${raw}`);
  }

  if (local.length === 11 && local[2] === "9") {
    const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
    keys.add(withoutNine);
    keys.add(`55${withoutNine}`);
  } else if (local.length === 10) {
    const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    keys.add(withNine);
    keys.add(`55${withNine}`);
  }

  return [...keys];
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

function classifyEtiqueta(
  nameNorm: string,
  monitoredNorm: string[]
): WhatsappAuditEtiquetaTipo | null {
  if (!nameNorm) return null;
  if (nameNorm.includes("cancelado")) return null;

  const isTotalPass =
    nameNorm.includes("totalpass") ||
    monitoredNorm.some(
      (m) => m.includes("totalpass") && (nameNorm === m || nameNorm.includes(m) || m.includes(nameNorm))
    );
  if (isTotalPass) return "totalpass";

  const isGympass =
    nameNorm.includes("gympass") ||
    monitoredNorm.some(
      (m) => m.includes("gympass") && (nameNorm === m || nameNorm.includes(m) || m.includes(nameNorm))
    );
  if (isGympass) return "gympass";

  return null;
}

function buildLabelMaps(labels: Record<string, unknown>[]) {
  const idToName = new Map<string, string>();
  for (const row of labels) {
    const name = extractLabelName(row);
    if (!name) continue;
    for (const key of extractLabelKeys(row)) {
      idToName.set(key, name);
      const suffix = key.includes(":") ? key.split(":").pop()! : key;
      idToName.set(suffix, name);
    }
  }
  return idToName;
}

function resolveChatLabels(
  chat: Record<string, unknown>,
  idToName: Map<string, string>,
  monitoredNorm: string[]
) {
  const raw = chat.wa_label ?? chat.labels ?? chat.wa_labels;
  const ids = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
  const names: string[] = [];
  const tipos = new Set<WhatsappAuditEtiquetaTipo>();
  let temCancelado = false;

  for (const waLabelId of ids) {
    const suffix = waLabelId.includes(":")
      ? (waLabelId.split(":").pop() ?? waLabelId)
      : waLabelId;
    const name =
      idToName.get(waLabelId) ?? idToName.get(suffix) ?? `Etiqueta ${suffix}`;
    names.push(name);
    const nameNorm = normalizeLabelName(name);
    if (nameNorm.includes("cancelado")) temCancelado = true;
    const tipo = classifyEtiqueta(nameNorm, monitoredNorm);
    if (tipo) tipos.add(tipo);
  }

  return {
    etiquetas: names,
    tipos: [...tipos],
    tem_cancelado: temCancelado,
    relevante: tipos.size > 0,
  };
}

function isLikelyBrPhone(digits: string) {
  // Local 10/11 ou com DDI 55 → 12/13
  if (digits.length === 10 || digits.length === 11) return true;
  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13)
  ) {
    return true;
  }
  return false;
}

/**
 * Extrai telefone real do chat Uazapi.
 * Chats só com LID (@lid) não têm celular — não usar o ID longo como telefone.
 */
function chatIdentity(chat: Record<string, unknown>): {
  telefone: string | null;
  telefoneOculto: boolean;
  chatId: string | null;
  dedupeKey: string;
} {
  const chatIdRaw = String(chat.wa_chatid ?? chat.id ?? "").trim();
  const chatId = chatIdRaw || null;
  const isLidJid = Boolean(chatId && /@lid\b/i.test(chatId));

  const fromPhone = digitsOnly(String(chat.phone ?? ""));
  if (fromPhone && isLikelyBrPhone(fromPhone)) {
    return {
      telefone: fromPhone,
      telefoneOculto: false,
      chatId,
      dedupeKey: fromPhone,
    };
  }

  // Só confia no chat id se for JID clássico (número@s.whatsapp.net)
  if (chatId && /@s\.whatsapp\.net$/i.test(chatId)) {
    const digits = digitsOnly(chatId.split("@")[0] ?? "");
    if (isLikelyBrPhone(digits)) {
      return {
        telefone: digits,
        telefoneOculto: false,
        chatId,
        dedupeKey: digits,
      };
    }
  }

  // LID ou dígitos longos demais = ID interno, não telefone
  const chatUser = chatId ? digitsOnly(chatId.split("@")[0] ?? "") : "";
  const looksLikeLid =
    isLidJid ||
    fromPhone.length > 13 ||
    (chatId != null &&
      chatUser.length > 13 &&
      !/@s\.whatsapp\.net$/i.test(chatId));

  if (looksLikeLid || chatId) {
    return {
      telefone: null,
      telefoneOculto: true,
      chatId,
      dedupeKey: chatId || `oculto:${fromPhone || "sem-id"}`,
    };
  }

  return {
    telefone: null,
    telefoneOculto: false,
    chatId: null,
    dedupeKey: "sem-telefone",
  };
}

function chatName(chat: Record<string, unknown>) {
  // Alinhado ao webhook Uazapi (lead_fullName costuma ser o contato salvo).
  const candidates = [
    chat.lead_fullName,
    chat.wa_contactName,
    chat.wa_name,
    chat.name,
    chat.lead_name,
    chat.notify,
    chat.pushName,
    chat.contactName,
  ];
  for (const c of candidates) {
    const name = String(c ?? "").trim();
    if (name) return name;
  }
  return null;
}

/**
 * Cruza chats Uazapi (etiquetas Cliente TotalPass / Cliente Gympass,
 * inclusive com CANCELADO junto) com telefones do Manager.
 */
export async function runWhatsappAudit(
  supabase: SupabaseClient
): Promise<WhatsappAuditResult> {
  const uazapi = await getUazapiConfig(supabase);
  if (!uazapi.url || !uazapi.token) {
    throw new Error(
      "Uazapi não configurada. Preencha URL e token em Configurações."
    );
  }

  const monitored =
    uazapi.etiquetas_monitoradas?.length
      ? uazapi.etiquetas_monitoradas
      : [...DEFAULT_ETIQUETAS_MONITORADAS];
  const monitoredNorm = monitored.map(normalizeLabelName).filter(Boolean);

  const client = new UazapiClient(uazapi);
  const [labels, chatsRaw, beneficiariosRes] = await Promise.all([
    client.listLabels(),
    client.findAllChats(500),
    supabase
      .from("beneficiarios")
      .select(
        "id, nome, cpf, telefone, perfil, status_totalpass"
      )
      .order("nome"),
  ]);

  if (beneficiariosRes.error) {
    throw new Error(
      `Erro ao buscar beneficiários: ${beneficiariosRes.error.message}`
    );
  }

  const beneficiarios = (beneficiariosRes.data ?? []) as Pick<
    Beneficiario,
    "id" | "nome" | "cpf" | "telefone" | "perfil" | "status_totalpass"
  >[];

  const idToName = buildLabelMaps(labels);

  // Índice telefone → beneficiário (primeiro encontrado; preferir titular se colisão).
  const byPhone = new Map<
    string,
    Pick<
      Beneficiario,
      "id" | "nome" | "cpf" | "telefone" | "perfil" | "status_totalpass"
    >
  >();
  for (const b of beneficiarios) {
    for (const key of phoneMatchKeys(b.telefone)) {
      const existing = byPhone.get(key);
      if (!existing || (existing.perfil !== "titular" && b.perfil === "titular")) {
        byPhone.set(key, b);
      }
    }
  }

  const matchedBeneficiarioIds = new Set<string>();
  const itens: WhatsappAuditItem[] = [];
  let totalpassWa = 0;
  let gympassWa = 0;
  let totalpassComCancelado = 0;

  const seenChat = new Set<string>();

  for (const chat of chatsRaw) {
    if (chat.wa_isGroup === true) continue;

    const identity = chatIdentity(chat);
    // Sem telefone real e sem chat id → não dá para listar
    if (!identity.telefone && !identity.chatId) continue;

    const resolved = resolveChatLabels(chat, idToName, monitoredNorm);
    if (!resolved.relevante) continue;

    const dedupeKey = `${identity.dedupeKey}|${resolved.tipos.sort().join(",")}`;
    if (seenChat.has(dedupeKey)) continue;
    seenChat.add(dedupeKey);

    if (resolved.tipos.includes("totalpass")) {
      totalpassWa += 1;
      if (resolved.tem_cancelado) totalpassComCancelado += 1;
    }
    if (resolved.tipos.includes("gympass")) gympassWa += 1;

    const phone = identity.telefone ?? "";
    let benef = null as (typeof beneficiarios)[number] | null;
    if (phone) {
      for (const key of phoneMatchKeys(phone)) {
        const hit = byPhone.get(key);
        if (hit) {
          benef = hit;
          break;
        }
      }
    }

    const waChatId = identity.chatId;

    if (benef) {
      matchedBeneficiarioIds.add(benef.id);
      itens.push({
        grupo: "bate",
        etiquetas: resolved.etiquetas,
        tipos: resolved.tipos,
        tem_cancelado: resolved.tem_cancelado,
        wa_nome: chatName(chat),
        wa_telefone: phone,
        telefone_oculto: identity.telefoneOculto,
        wa_chat_id: waChatId,
        beneficiario_id: benef.id,
        beneficiario_nome: benef.nome,
        beneficiario_cpf: benef.cpf,
        beneficiario_telefone: benef.telefone,
        beneficiario_perfil: benef.perfil,
        beneficiario_status: benef.status_totalpass,
      });
    } else {
      itens.push({
        grupo: "so_whatsapp",
        etiquetas: resolved.etiquetas,
        tipos: resolved.tipos,
        tem_cancelado: resolved.tem_cancelado,
        wa_nome: chatName(chat),
        wa_telefone: phone,
        telefone_oculto: identity.telefoneOculto,
        wa_chat_id: waChatId,
        beneficiario_id: null,
        beneficiario_nome: null,
        beneficiario_cpf: null,
        beneficiario_telefone: null,
        beneficiario_perfil: null,
        beneficiario_status: null,
      });
    }
  }

  // Titulares ativos/elegíveis cujo telefone não aparece em nenhum chat etiquetado.
  for (const b of beneficiarios) {
    if (b.perfil !== "titular") continue;
    if (b.status_totalpass !== "ativo" && b.status_totalpass !== "elegivel") {
      continue;
    }
    if (!b.telefone || matchedBeneficiarioIds.has(b.id)) continue;

    itens.push({
      grupo: "so_manager",
      etiquetas: [],
      tipos: [],
      tem_cancelado: false,
      wa_nome: null,
      wa_telefone: "",
      telefone_oculto: false,
      wa_chat_id: null,
      beneficiario_id: b.id,
      beneficiario_nome: b.nome,
      beneficiario_cpf: b.cpf,
      beneficiario_telefone: b.telefone,
      beneficiario_perfil: b.perfil,
      beneficiario_status: b.status_totalpass,
    });
  }

  const bate = itens.filter((i) => i.grupo === "bate").length;
  const soWhatsapp = itens.filter((i) => i.grupo === "so_whatsapp").length;
  const soManager = itens.filter((i) => i.grupo === "so_manager").length;

  itens.sort((a, b) => {
    const order = { bate: 0, so_whatsapp: 1, so_manager: 2 };
    const d = order[a.grupo] - order[b.grupo];
    if (d !== 0) return d;
    const na = (a.beneficiario_nome || a.wa_nome || "").toLowerCase();
    const nb = (b.beneficiario_nome || b.wa_nome || "").toLowerCase();
    return na.localeCompare(nb, "pt-BR");
  });

  return {
    ok: true,
    gerado_em: new Date().toISOString(),
    chats_analisados: chatsRaw.length,
    etiquetas_alvo: monitored,
    resumo: {
      bate,
      so_whatsapp: soWhatsapp,
      so_manager: soManager,
      totalpass_wa: totalpassWa,
      gympass_wa: gympassWa,
      totalpass_com_cancelado: totalpassComCancelado,
    },
    itens,
  };
}
