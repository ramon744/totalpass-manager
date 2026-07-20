import { NextRequest } from "next/server";
import {
  authenticateBridge,
  bridgeJson,
  bridgeOptions,
} from "@/lib/totalpass-bridge/auth";

const METHODS = "POST, OPTIONS";

type CheckinItem = {
  cpf?: string | null;
  nome?: string | null;
  checkins?: number | string | null;
};

type CheckinsPayload = {
  period_start?: string | null;
  period_end?: string | null;
  reset_missing?: boolean;
  items?: CheckinItem[];
};

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

/** CPF do Excel perde zeros à esquerda (vem como número). Repõe até 11 dígitos. */
function normalizeCpf11(value: string | null | undefined) {
  const digits = onlyDigits(value);
  if (!digits || digits.length > 11) return "";
  return digits.padStart(11, "0");
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isValidDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function OPTIONS(request: NextRequest) {
  return bridgeOptions(request, METHODS);
}

/**
 * Recebe a frequência de check-ins (relatório do HR) e grava por beneficiário.
 * Auth: cookie Supabase OU x-tp-bridge-secret (mesma da ponte/sync).
 * Não cria/edita assinaturas nem toca em cobrança — apenas dados de uso.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateBridge(request);
  if (!auth.ok) {
    return bridgeJson(request, { error: auth.error }, auth.status, METHODS);
  }
  const supabase = auth.supabase;

  let body: CheckinsPayload;
  try {
    body = await request.json();
  } catch {
    return bridgeJson(request, { error: "JSON inválido" }, 400, METHODS);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return bridgeJson(
      request,
      { error: "Nenhum item de check-in recebido" },
      400,
      METHODS
    );
  }

  const periodoInicio = isValidDate(body.period_start) ? body.period_start : null;
  const periodoFim = isValidDate(body.period_end) ? body.period_end : null;
  const resetMissing = body.reset_missing !== false;

  const byCpf = new Map<string, number>();
  const byNome = new Map<string, number>();

  for (const item of items) {
    const checkins = Math.max(0, Math.round(Number(item.checkins) || 0));
    const cpf = normalizeCpf11(item.cpf);
    if (cpf.length === 11) {
      byCpf.set(cpf, Math.max(byCpf.get(cpf) ?? 0, checkins));
      continue;
    }
    const nome = normalizeName(item.nome);
    if (nome) {
      byNome.set(nome, Math.max(byNome.get(nome) ?? 0, checkins));
    }
  }

  const { data: beneficiarios, error: fetchError } = await supabase
    .from("beneficiarios")
    .select("id, cpf, nome, status_totalpass");

  if (fetchError) {
    return bridgeJson(
      request,
      { error: `Erro ao buscar beneficiários: ${fetchError.message}` },
      500,
      METHODS
    );
  }

  const nowIso = new Date().toISOString();
  const lista = (beneficiarios ?? []) as {
    id: string;
    cpf: string | null;
    nome: string | null;
    status_totalpass: string;
  }[];

  // 1ª passada: encontra o valor de cada beneficiário (por CPF, senão por nome).
  const matchedValue = new Map<string, number>();
  for (const b of lista) {
    const cpf = normalizeCpf11(b.cpf);
    if (cpf && byCpf.has(cpf)) {
      matchedValue.set(b.id, byCpf.get(cpf)!);
      continue;
    }
    const nome = normalizeName(b.nome);
    if (nome && byNome.has(nome)) matchedValue.set(b.id, byNome.get(nome)!);
  }

  const matched = matchedValue.size;
  const ativos = lista.filter((b) => b.status_totalpass === "ativo").length;
  // Só zera ausentes se a leitura parecer completa (evita zerar por leitura parcial).
  const allowReset =
    resetMissing && (ativos === 0 || matched >= Math.ceil(ativos * 0.4));

  // Agrupa por valor de check-in para reduzir número de updates.
  const idsByValue = new Map<number, string[]>();
  let zeroed = 0;

  for (const b of lista) {
    let value: number | null = matchedValue.has(b.id)
      ? matchedValue.get(b.id)!
      : null;

    if (value === null) {
      if (allowReset && b.status_totalpass === "ativo") {
        value = 0;
        zeroed += 1;
      } else {
        continue;
      }
    }

    const list = idsByValue.get(value) ?? [];
    list.push(b.id);
    idsByValue.set(value, list);
  }

  let updated = 0;
  for (const [value, ids] of idsByValue) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error: updateError } = await supabase
        .from("beneficiarios")
        .update({
          checkins_30d: value,
          checkins_periodo_inicio: periodoInicio,
          checkins_periodo_fim: periodoFim,
          checkins_atualizado_em: nowIso,
        })
        .in("id", chunk);

      if (updateError) {
        return bridgeJson(
          request,
          { error: `Erro ao atualizar check-ins: ${updateError.message}` },
          500,
          METHODS
        );
      }
      updated += chunk.length;
    }
  }

  return bridgeJson(
    request,
    {
      ok: true,
      recebidos: items.length,
      correspondidos: matched,
      zerados: zeroed,
      atualizados: updated,
      reset_aplicado: allowReset,
      periodo: { inicio: periodoInicio, fim: periodoFim },
    },
    200,
    METHODS
  );
}
