import type { SupabaseClient } from "@supabase/supabase-js";
import { createLog } from "@/lib/logger";
import { reconcileDependentBillingForTitular } from "@/lib/services/subscriptions";
import type { ProvedorInput } from "@/types/database";

/** Recalcula assinaturas ativas dos titulares do provedor (ex.: ao ligar/desligar cobrança de dependentes). */
async function reconcileAssinaturasDoProvedor(
  supabase: SupabaseClient,
  provedorId: string,
  userId?: string
) {
  const { data: titulares } = await supabase
    .from("beneficiarios")
    .select("id, assinaturas!inner(status)")
    .eq("provedor_id", provedorId)
    .eq("perfil", "titular")
    .eq("assinaturas.status", "ACTIVE");

  for (const titular of titulares ?? []) {
    try {
      await reconcileDependentBillingForTitular(supabase, titular.id, {
        userId,
        motivo: "alteração na cobrança de dependentes do provedor",
      });
    } catch {
      // Segue para os demais titulares; o restante pode ser reconciliado depois.
    }
  }
}

export function normalizeNomeProvedor(nome: string) {
  return nome.trim().replace(/\s+/g, " ");
}

export function isProvedorCompleto(input: {
  beneficio?: string | null;
  custo_colaborador?: number | null;
  dia_pagamento?: number | null;
  valor_cobrado_mensal?: number | null;
  cobrar_dependentes?: boolean | null;
  valor_dependente?: number | null;
  mensagem_padrao?: string | null;
}) {
  return Boolean(
    input.beneficio?.trim() &&
      input.custo_colaborador != null &&
      input.custo_colaborador > 0 &&
      input.dia_pagamento != null &&
      input.dia_pagamento >= 1 &&
      input.dia_pagamento <= 28 &&
      input.valor_cobrado_mensal != null &&
      input.valor_cobrado_mensal > 0 &&
      (!input.cobrar_dependentes ||
        (input.valor_dependente != null && input.valor_dependente > 0)) &&
      input.mensagem_padrao?.trim()
  );
}

function validateInput(input: ProvedorInput) {
  const nome = normalizeNomeProvedor(input.nome);
  if (!nome) throw new Error("Nome da empresa é obrigatório");
  if (!input.beneficio?.trim()) throw new Error("Benefício é obrigatório");
  if (!input.custo_colaborador || input.custo_colaborador <= 0) {
    throw new Error("Custo por colaborador deve ser maior que zero");
  }
  if (!input.dia_pagamento || input.dia_pagamento < 1 || input.dia_pagamento > 28) {
    throw new Error("Dia de pagamento deve ser entre 1 e 28");
  }
  if (!input.valor_cobrado_mensal || input.valor_cobrado_mensal <= 0) {
    throw new Error("Valor cobrado mensal do cliente deve ser maior que zero");
  }
  if (input.cobrar_dependentes && (!input.valor_dependente || input.valor_dependente <= 0)) {
    throw new Error("Valor por dependente deve ser maior que zero");
  }
  if (!input.mensagem_padrao?.trim()) {
    throw new Error("Mensagem padrão é obrigatória");
  }
  return {
    nome,
    beneficio: input.beneficio.trim(),
    custo_colaborador: input.custo_colaborador,
    dia_pagamento: input.dia_pagamento,
    valor_cobrado_mensal: input.valor_cobrado_mensal,
    cobrar_dependentes: Boolean(input.cobrar_dependentes),
    valor_dependente:
      input.valor_dependente != null && Number(input.valor_dependente) > 0
        ? input.valor_dependente
        : null,
    mensagem_padrao: input.mensagem_padrao.trim(),
    cadastro_completo: true,
  };
}

export async function findProvedorByNomeExato(
  supabase: SupabaseClient,
  nome: string
) {
  const normalized = normalizeNomeProvedor(nome);
  if (!normalized) return null;

  const { data } = await supabase
    .from("provedores")
    .select("*")
    .eq("nome", normalized)
    .maybeSingle();

  return data;
}

export async function findOrCreateProvedor(
  supabase: SupabaseClient,
  nome: string,
  cache?: Map<string, { id: string; criado: boolean }>
): Promise<{ id: string | null; criado: boolean }> {
  const normalized = normalizeNomeProvedor(nome);
  if (!normalized) return { id: null, criado: false };

  const cacheKey = normalized;
  if (cache?.has(cacheKey)) {
    const cached = cache.get(cacheKey)!;
    return { id: cached.id, criado: cached.criado };
  }

  const existing = await findProvedorByNomeExato(supabase, normalized);
  if (existing) {
    cache?.set(cacheKey, { id: existing.id, criado: false });
    return { id: existing.id, criado: false };
  }

  const { data: created, error } = await supabase
    .from("provedores")
    .insert({
      nome: normalized,
      cadastro_completo: false,
    })
    .select("id")
    .single();

  if (error) {
    const retry = await findProvedorByNomeExato(supabase, normalized);
    if (retry) {
      cache?.set(cacheKey, { id: retry.id, criado: false });
      return { id: retry.id, criado: false };
    }
    throw new Error(error.message);
  }

  cache?.set(cacheKey, { id: created.id, criado: true });
  return { id: created.id, criado: true };
}

export async function createProvedor(
  supabase: SupabaseClient,
  input: ProvedorInput,
  userId?: string
) {
  const data = validateInput(input);

  const existing = await findProvedorByNomeExato(supabase, data.nome);
  if (existing) throw new Error("Já existe um provedor com este nome exato");

  const { data: created, error } = await supabase
    .from("provedores")
    .insert({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "provedor_criado_manual",
    entidade: "provedores",
    entidade_id: created.id,
    payload: { nome: data.nome },
  });

  return created;
}

export async function updateProvedor(
  supabase: SupabaseClient,
  id: string,
  input: ProvedorInput,
  userId?: string
) {
  const data = validateInput(input);

  const { data: current } = await supabase
    .from("provedores")
    .select("id, nome, cobrar_dependentes, valor_dependente")
    .eq("id", id)
    .single();

  if (!current) throw new Error("Provedor não encontrado");

  if (
    !data.cobrar_dependentes &&
    !data.valor_dependente &&
    current.valor_dependente != null &&
    Number(current.valor_dependente) > 0
  ) {
    data.valor_dependente = Number(current.valor_dependente);
  }

  if (current.nome !== data.nome) {
    const duplicate = await findProvedorByNomeExato(supabase, data.nome);
    if (duplicate && duplicate.id !== id) {
      throw new Error("Já existe outro provedor com este nome exato");
    }
  }

  const { data: updated, error } = await supabase
    .from("provedores")
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "provedor_atualizado",
    entidade: "provedores",
    entidade_id: id,
    payload: { nome: data.nome },
  });

  const cobrancaDependentesMudou =
    Boolean(current.cobrar_dependentes) !== Boolean(data.cobrar_dependentes) ||
    Number(current.valor_dependente ?? 0) !== Number(data.valor_dependente ?? 0);

  if (cobrancaDependentesMudou) {
    await reconcileAssinaturasDoProvedor(supabase, id, userId);
  }

  return updated;
}
