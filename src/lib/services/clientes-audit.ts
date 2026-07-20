import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneMatchKeys } from "@/lib/services/whatsapp-audit";

export type ClientesAuditGrupo =
  | "bate"
  | "so_infinity"
  | "so_manager";

export type ClientesAuditItem = {
  grupo: ClientesAuditGrupo;
  infinity_customer_id: string | null;
  infinity_nome: string | null;
  infinity_cpf: string | null;
  infinity_email: string | null;
  infinity_phone: string | null;
  payment_status: string | null;
  synced_at: string | null;
  beneficiario_id: string | null;
  beneficiario_nome: string | null;
  beneficiario_cpf: string | null;
  beneficiario_status: string | null;
  gateway_pagamento: string | null;
  provedor_id: string | null;
  provedor_nome: string | null;
  /** Nome do contato no pré-cadastro WhatsApp (se houver match por telefone). */
  wa_nome: string | null;
  /** Etiquetas do pré-cadastro WhatsApp (se houver match por telefone). */
  wa_etiquetas: string[];
  sugestao: string;
};

export type ClientesAuditResult = {
  ok: true;
  gerado_em: string;
  fonte: "infinity_customer_status";
  resumo: {
    infinity_total: number;
    manager_titulares: number;
    bate: number;
    so_infinity: number;
    so_manager: number;
    overdue: number;
    pending: number;
    paid: number;
    unknown: number;
  };
  itens: ClientesAuditItem[];
};

function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function classifyWaHint(etiquetas: string[]): string {
  const norms = etiquetas.map(normalizeLabel);
  const hasGym = norms.some((e) => e.includes("gympass") || e.includes("wellhub"));
  const hasTp = norms.some(
    (e) => e.includes("cliente totalpass") || e === "totalpass"
  );
  const hasCancel = norms.some((e) => e.includes("cancelado"));

  if (hasGym && !hasTp) {
    return hasCancel
      ? "Provável Gympass/Wellhub (etiqueta) · cancelado"
      : "Provável Gympass/Wellhub (etiqueta WhatsApp)";
  }
  if (hasTp) {
    return hasCancel
      ? "Etiqueta TotalPass + cancelado — conferir se é seu HR ou do amigo"
      : "Etiqueta Cliente TotalPass — pode ser seu ou do amigo (não está no Manager)";
  }
  return "Não está no seu TotalPass — terceirizado (amigo) ou Gympass/outro";
}

/**
 * Auditoria Infinity ↔ Manager (titulares) por CPF.
 * Usa o último sync da extensão (`infinity_customer_status`).
 */
export async function runClientesAudit(
  supabase: SupabaseClient
): Promise<ClientesAuditResult> {
  const [{ data: infinityRows, error: infErr }, { data: titulares, error: benErr }] =
    await Promise.all([
      supabase
        .from("infinity_customer_status")
        .select(
          "infinity_customer_id, nome, document_number, email, phone, payment_status, synced_at, beneficiario_id"
        )
        .order("nome", { ascending: true }),
      supabase
        .from("beneficiarios")
        .select(
          "id, nome, cpf, telefone, status_totalpass, gateway_pagamento, infinity_customer_id, provedor_id, provedor:provedores(id, nome)"
        )
        .eq("perfil", "titular"),
    ]);

  if (infErr) throw new Error(infErr.message);
  if (benErr) throw new Error(benErr.message);

  const { data: preCadastros } = await supabase
    .from("pre_cadastros_whatsapp")
    .select("telefone, etiquetas, nome, updated_at")
    .order("updated_at", { ascending: false });

  const etiquetaByPhoneKey = new Map<string, string[]>();
  const nomeByPhoneKey = new Map<string, string>();

  for (const pre of preCadastros ?? []) {
    const tags = Array.isArray(pre.etiquetas)
      ? (pre.etiquetas as string[]).filter(Boolean)
      : [];
    const preNome = String(pre.nome ?? "").trim();
    const keys = phoneMatchKeys(pre.telefone);
    if (!keys.length) continue;

    for (const key of keys) {
      if (tags.length) {
        const prev = etiquetaByPhoneKey.get(key) ?? [];
        etiquetaByPhoneKey.set(key, [...new Set([...prev, ...tags])]);
      }
      // Já ordenado por updated_at DESC — primeiro nome preenchido ganha.
      if (preNome && !nomeByPhoneKey.has(key)) {
        nomeByPhoneKey.set(key, preNome);
      }
    }
  }

  function waInfoForPhone(phone: string | null | undefined): {
    etiquetas: string[];
    nome: string | null;
  } {
    if (!phone) return { etiquetas: [], nome: null };
    const found = new Set<string>();
    let nome: string | null = null;
    for (const key of phoneMatchKeys(phone)) {
      for (const t of etiquetaByPhoneKey.get(key) ?? []) found.add(t);
      if (!nome && nomeByPhoneKey.has(key)) {
        nome = nomeByPhoneKey.get(key) ?? null;
      }
    }
    return { etiquetas: [...found], nome };
  }

  type Titular = {
    id: string;
    nome: string;
    cpf: string;
    telefone: string | null;
    status_totalpass: string;
    gateway_pagamento: string | null;
    infinity_customer_id: string | null;
    provedor_id: string | null;
    provedor?: { id: string; nome: string } | { id: string; nome: string }[] | null;
  };

  function provedorNomeOf(t: Titular): string | null {
    const p = t.provedor;
    if (!p) return null;
    if (Array.isArray(p)) return p[0]?.nome?.trim() || null;
    return p.nome?.trim() || null;
  }

  const byCpf = new Map<string, Titular>();
  for (const t of (titulares ?? []) as Titular[]) {
    const cpf = digitsOnly(t.cpf);
    if (cpf) byCpf.set(cpf, t);
  }

  const matchedCpf = new Set<string>();
  const itens: ClientesAuditItem[] = [];

  let overdue = 0;
  let pending = 0;
  let paid = 0;
  let unknown = 0;

  for (const row of infinityRows ?? []) {
    const cpf = digitsOnly(row.document_number);
    const titular = cpf ? byCpf.get(cpf) : undefined;
    const status = String(row.payment_status || "unknown");
    if (status === "overdue") overdue++;
    else if (status === "pending") pending++;
    else if (status === "paid") paid++;
    else unknown++;

    const wa = waInfoForPhone(row.phone);

    if (titular) {
      matchedCpf.add(digitsOnly(titular.cpf));
      itens.push({
        grupo: "bate",
        infinity_customer_id: row.infinity_customer_id,
        infinity_nome: row.nome,
        infinity_cpf: cpf || null,
        infinity_email: row.email,
        infinity_phone: row.phone,
        payment_status: status,
        synced_at: row.synced_at,
        beneficiario_id: titular.id,
        beneficiario_nome: titular.nome,
        beneficiario_cpf: titular.cpf,
        beneficiario_status: titular.status_totalpass,
        gateway_pagamento: titular.gateway_pagamento,
        provedor_id: titular.provedor_id,
        provedor_nome: provedorNomeOf(titular),
        wa_nome: wa.nome,
        wa_etiquetas: wa.etiquetas,
        sugestao:
          titular.gateway_pagamento === "infinity"
            ? "Já marcado como Infinity no Manager"
            : "No Manager — considere gateway Infinity na ficha",
      });
    } else {
      itens.push({
        grupo: "so_infinity",
        infinity_customer_id: row.infinity_customer_id,
        infinity_nome: row.nome,
        infinity_cpf: cpf || null,
        infinity_email: row.email,
        infinity_phone: row.phone,
        payment_status: status,
        synced_at: row.synced_at,
        beneficiario_id: null,
        beneficiario_nome: null,
        beneficiario_cpf: null,
        beneficiario_status: null,
        gateway_pagamento: null,
        provedor_id: null,
        provedor_nome: null,
        wa_nome: wa.nome,
        wa_etiquetas: wa.etiquetas,
        sugestao: classifyWaHint(wa.etiquetas),
      });
    }
  }

  for (const t of (titulares ?? []) as Titular[]) {
    const cpf = digitsOnly(t.cpf);
    if (!cpf || matchedCpf.has(cpf)) continue;
    const wa = waInfoForPhone(t.telefone);
    itens.push({
      grupo: "so_manager",
      infinity_customer_id: t.infinity_customer_id,
      infinity_nome: null,
      infinity_cpf: null,
      infinity_email: null,
      infinity_phone: null,
      payment_status: null,
      synced_at: null,
      beneficiario_id: t.id,
      beneficiario_nome: t.nome,
      beneficiario_cpf: t.cpf,
      beneficiario_status: t.status_totalpass,
      gateway_pagamento: t.gateway_pagamento,
      provedor_id: t.provedor_id,
      provedor_nome: provedorNomeOf(t),
      wa_nome: wa.nome,
      wa_etiquetas: wa.etiquetas,
      sugestao:
        t.status_totalpass === "inativo"
          ? "No Manager sem Infinity (inativo)"
          : "No Manager sem cobrança Infinity no sync",
    });
  }

  const ordemGrupo: Record<ClientesAuditGrupo, number> = {
    so_infinity: 0,
    bate: 1,
    so_manager: 2,
  };
  itens.sort((a, b) => {
    const g = ordemGrupo[a.grupo] - ordemGrupo[b.grupo];
    if (g !== 0) return g;
    const na = (a.infinity_nome || a.beneficiario_nome || "").localeCompare(
      b.infinity_nome || b.beneficiario_nome || "",
      "pt-BR"
    );
    return na;
  });

  return {
    ok: true,
    gerado_em: new Date().toISOString(),
    fonte: "infinity_customer_status",
    resumo: {
      infinity_total: infinityRows?.length ?? 0,
      manager_titulares: titulares?.length ?? 0,
      bate: itens.filter((i) => i.grupo === "bate").length,
      so_infinity: itens.filter((i) => i.grupo === "so_infinity").length,
      so_manager: itens.filter((i) => i.grupo === "so_manager").length,
      overdue,
      pending,
      paid,
      unknown,
    },
    itens,
  };
}
