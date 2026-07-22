import type { SupabaseClient } from "@supabase/supabase-js";
import { UazapiClient } from "@/lib/uazapi/client";
import { getUazapiConfig } from "@/lib/config";
import {
  DEFAULT_ETIQUETAS_MONITORADAS,
  type Beneficiario,
} from "@/types/database";

export type WhatsappAuditGrupo = "bate" | "so_whatsapp" | "so_manager";

export type WhatsappAuditEtiquetaTipo = "totalpass" | "gympass" | "outra";

/** Como o chat foi ligado ao beneficiário (mais forte → mais fraco). */
export type WhatsappAuditMatchPor =
  | "manager_phone"
  | "infinity_phone"
  | "email"
  | "cpf";

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
  /** Telefone sincronizado da InfinitePay (contato da cobrança). */
  infinity_telefone: string | null;
  beneficiario_email: string | null;
  beneficiario_perfil: string | null;
  beneficiario_status: string | null;
  /** Motivo do cruzamento; null se só Manager / só WhatsApp. */
  match_por: WhatsappAuditMatchPor | null;
  /** Manager e Infinity com números diferentes (após normalizar). */
  telefones_divergentes: boolean;
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

function normalizeEmail(value: string | null | undefined) {
  const e = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!e || !e.includes("@")) return null;
  return e;
}

function chatEmail(chat: Record<string, unknown>) {
  const candidates = [
    chat.email,
    chat.lead_email,
    chat.wa_email,
    chat.lead_EmailAddress,
    chat.contactEmail,
  ];
  for (const c of candidates) {
    const e = normalizeEmail(String(c ?? ""));
    if (e) return e;
  }
  return null;
}

/** CPF só dígitos (11). */
function normalizeCpf(value: string | null | undefined) {
  const d = digitsOnly(value);
  return d.length === 11 ? d : null;
}

type BenefRow = Pick<
  Beneficiario,
  "id" | "nome" | "cpf" | "telefone" | "email" | "perfil" | "status_totalpass"
>;

type IdentityProfile = BenefRow & {
  infinity_telefone: string | null;
  phones: string[];
  emails: string[];
  telefones_divergentes: boolean;
};

function phonesDiverge(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const ka = new Set(phoneMatchKeys(a));
  return !phoneMatchKeys(b).some((k) => ka.has(k));
}

function preferTitular(
  existing: IdentityProfile | undefined,
  next: IdentityProfile
) {
  if (!existing) return next;
  if (existing.perfil !== "titular" && next.perfil === "titular") return next;
  return existing;
}

/**
 * Cruza chats Uazapi (etiquetas Cliente TotalPass / Cliente Gympass)
 * com identidade do Manager + Infinity (telefones, e-mail, CPF).
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
  const [labels, chatsRaw, beneficiariosRes, infinityRes] = await Promise.all([
    client.listLabels(),
    client.findAllChats(500),
    supabase
      .from("beneficiarios")
      .select("id, nome, cpf, telefone, email, perfil, status_totalpass")
      .order("nome"),
    supabase
      .from("infinity_customer_status")
      .select("beneficiario_id, document_number, email, phone"),
  ]);

  if (beneficiariosRes.error) {
    throw new Error(
      `Erro ao buscar beneficiários: ${beneficiariosRes.error.message}`
    );
  }
  // Infinity é enriquecimento: se falhar, a auditoria segue só com Manager.
  if (infinityRes.error) {
    console.warn(
      "[whatsapp-audit] infinity_customer_status:",
      infinityRes.error.message
    );
  }

  const beneficiarios = (beneficiariosRes.data ?? []) as BenefRow[];

  // Infinity por beneficiario_id e por CPF (document_number)
  type InfRow = {
    beneficiario_id: string | null;
    document_number: string | null;
    email: string | null;
    phone: string | null;
  };
  const infinityRows = (infinityRes.data ?? []) as InfRow[];
  const infinityByBenefId = new Map<string, InfRow>();
  const infinityByCpf = new Map<string, InfRow>();
  for (const row of infinityRows) {
    if (row.beneficiario_id) {
      infinityByBenefId.set(row.beneficiario_id, row);
    }
    const cpf = normalizeCpf(row.document_number);
    if (cpf) infinityByCpf.set(cpf, row);
  }

  const profiles: IdentityProfile[] = beneficiarios.map((b) => {
    const inf =
      infinityByBenefId.get(b.id) ||
      (normalizeCpf(b.cpf) ? infinityByCpf.get(normalizeCpf(b.cpf)!) : undefined);
    const managerPhone = digitsOnly(b.telefone) || null;
    const infinityPhone = digitsOnly(inf?.phone) || null;
    const phones = [
      ...new Set(
        [managerPhone, infinityPhone].filter((p): p is string => Boolean(p))
      ),
    ];
    const emails = [
      ...new Set(
        [normalizeEmail(b.email), normalizeEmail(inf?.email)].filter(
          (e): e is string => Boolean(e)
        )
      ),
    ];
    return {
      ...b,
      infinity_telefone: infinityPhone,
      phones,
      emails,
      telefones_divergentes: phonesDiverge(managerPhone, infinityPhone),
    };
  });

  const idToName = buildLabelMaps(labels);

  const byPhone = new Map<
    string,
    { profile: IdentityProfile; match_por: WhatsappAuditMatchPor }
  >();
  const byEmail = new Map<string, IdentityProfile>();

  for (const p of profiles) {
    const managerKeys = new Set(phoneMatchKeys(p.telefone));
    for (const phone of p.phones) {
      const isManager = phoneMatchKeys(phone).some((k) => managerKeys.has(k));
      const match_por: WhatsappAuditMatchPor = isManager
        ? "manager_phone"
        : "infinity_phone";
      for (const key of phoneMatchKeys(phone)) {
        const existing = byPhone.get(key);
        if (
          !existing ||
          (existing.profile.perfil !== "titular" && p.perfil === "titular")
        ) {
          byPhone.set(key, { profile: p, match_por });
        } else if (
          existing.match_por === "infinity_phone" &&
          match_por === "manager_phone"
        ) {
          // Preferir marcar manager_phone se o mesmo key couber nos dois
          byPhone.set(key, { profile: preferTitular(existing.profile, p), match_por });
        }
      }
    }
    for (const email of p.emails) {
      byEmail.set(email, preferTitular(byEmail.get(email), p));
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
    const email = chatEmail(chat);
    let profile: IdentityProfile | null = null;
    let match_por: WhatsappAuditMatchPor | null = null;

    if (phone) {
      for (const key of phoneMatchKeys(phone)) {
        const hit = byPhone.get(key);
        if (hit) {
          profile = hit.profile;
          match_por = hit.match_por;
          break;
        }
      }
    }
    if (!profile && email) {
      const hit = byEmail.get(email);
      if (hit) {
        profile = hit;
        match_por = "email";
      }
    }

    const waChatId = identity.chatId;

    if (profile) {
      matchedBeneficiarioIds.add(profile.id);
      itens.push({
        grupo: "bate",
        etiquetas: resolved.etiquetas,
        tipos: resolved.tipos,
        tem_cancelado: resolved.tem_cancelado,
        wa_nome: chatName(chat),
        wa_telefone: phone,
        telefone_oculto: identity.telefoneOculto,
        wa_chat_id: waChatId,
        beneficiario_id: profile.id,
        beneficiario_nome: profile.nome,
        beneficiario_cpf: profile.cpf,
        beneficiario_telefone: profile.telefone,
        infinity_telefone: profile.infinity_telefone,
        beneficiario_email: profile.email ?? profile.emails[0] ?? null,
        beneficiario_perfil: profile.perfil,
        beneficiario_status: profile.status_totalpass,
        match_por,
        telefones_divergentes: profile.telefones_divergentes,
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
        infinity_telefone: null,
        beneficiario_email: null,
        beneficiario_perfil: null,
        beneficiario_status: null,
        match_por: null,
        telefones_divergentes: false,
      });
    }
  }

  // Titulares ativos/elegíveis sem chat etiquetado (nem pelo tel. Manager nem Infinity).
  for (const p of profiles) {
    if (p.perfil !== "titular") continue;
    if (p.status_totalpass !== "ativo" && p.status_totalpass !== "elegivel") {
      continue;
    }
    if (matchedBeneficiarioIds.has(p.id)) continue;
    // Precisa de algum telefone (Manager ou Infinity) para entrar na lista operacional
    if (p.phones.length === 0) continue;

    itens.push({
      grupo: "so_manager",
      etiquetas: [],
      tipos: [],
      tem_cancelado: false,
      wa_nome: null,
      wa_telefone: "",
      telefone_oculto: false,
      wa_chat_id: null,
      beneficiario_id: p.id,
      beneficiario_nome: p.nome,
      beneficiario_cpf: p.cpf,
      beneficiario_telefone: p.telefone,
      infinity_telefone: p.infinity_telefone,
      beneficiario_email: p.email ?? p.emails[0] ?? null,
      beneficiario_perfil: p.perfil,
      beneficiario_status: p.status_totalpass,
      match_por: null,
      telefones_divergentes: p.telefones_divergentes,
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
