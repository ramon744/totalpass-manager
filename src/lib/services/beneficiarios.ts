import type { SupabaseClient } from "@supabase/supabase-js";
import { AsaasClient } from "@/lib/asaas/client";
import { getAsaasConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import {
  isDependenteCobravelPorStatus,
  shouldAutoCobrarNovoDependente,
  titularJaCobraDependentesNoBanco,
} from "@/lib/dependent-billing";
import {
  cancelActiveSubscriptionsForBeneficiario,
  reconcileDependentBillingForTitular,
} from "@/lib/services/subscriptions";
import { normalizeCpf } from "@/lib/utils";
import { isValidCpf } from "@/lib/validators/cpf";
import { isValidPhone, sanitizePhone } from "@/lib/validators/phone";
import type {
  Beneficiario,
  GatewayPagamento,
  PerfilBeneficiario,
  StatusTotalpass,
} from "@/types/database";

const GATEWAYS: GatewayPagamento[] = ["asaas", "infinity", "nenhum"];

export interface BeneficiarioInput {
  nome: string;
  cpf: string;
  telefone?: string | null;
  email?: string | null;
  perfil: PerfilBeneficiario;
  titular_id?: string | null;
  provedor_id?: string | null;
  status_totalpass: StatusTotalpass;
  plano?: string | null;
  data_aderido_totalpass?: string | null;
  observacoes?: string | null;
  /** Só titular. Dependente força `nenhum`. Default titular: `asaas`. */
  gateway_pagamento?: GatewayPagamento | null;
  infinity_customer_id?: string | null;
  infinity_subscription_slug?: string | null;
}

function normalizeGateway(
  perfil: PerfilBeneficiario,
  gateway?: GatewayPagamento | null
): GatewayPagamento {
  if (perfil === "dependente") return "nenhum";
  if (gateway && GATEWAYS.includes(gateway)) return gateway;
  return "asaas";
}

function validateInput(input: BeneficiarioInput) {
  const cpf = normalizeCpf(input.cpf);
  if (!input.nome?.trim()) throw new Error("Nome é obrigatório");
  if (!cpf) throw new Error("CPF é obrigatório");
  if (!isValidCpf(cpf)) throw new Error("CPF inválido");
  if (input.telefone && !isValidPhone(input.telefone)) {
    throw new Error("Telefone inválido");
  }
  if (input.perfil === "dependente" && !input.titular_id) {
    throw new Error("Dependente precisa estar vinculado a um titular");
  }
  if (input.perfil === "titular" && input.titular_id) {
    throw new Error("Titular não pode ter vínculo com outro titular");
  }
  if (
    input.gateway_pagamento !== undefined &&
    input.gateway_pagamento !== null &&
    !GATEWAYS.includes(input.gateway_pagamento)
  ) {
    throw new Error("Gateway de pagamento inválido");
  }

  // undefined = não alterar no update; create aplica default depois.
  const gatewayProvided = input.gateway_pagamento !== undefined;
  const infinityCustomerProvided = input.infinity_customer_id !== undefined;
  const infinitySlugProvided = input.infinity_subscription_slug !== undefined;

  return {
    ...input,
    cpf,
    nome: input.nome.trim(),
    telefone: input.telefone ? sanitizePhone(input.telefone) : null,
    email: input.email?.trim() || null,
    plano: input.plano?.trim() || null,
    observacoes: input.observacoes?.trim() || null,
    data_aderido_totalpass: input.data_aderido_totalpass || null,
    titular_id: input.perfil === "dependente" ? input.titular_id : null,
    provedor_id: input.provedor_id || null,
    gateway_pagamento: gatewayProvided
      ? normalizeGateway(input.perfil, input.gateway_pagamento)
      : undefined,
    infinity_customer_id: !infinityCustomerProvided
      ? undefined
      : input.perfil === "titular"
        ? input.infinity_customer_id?.trim() || null
        : null,
    infinity_subscription_slug: !infinitySlugProvided
      ? undefined
      : input.perfil === "titular"
        ? input.infinity_subscription_slug?.trim() || null
        : null,
  };
}

export async function createBeneficiario(
  supabase: SupabaseClient,
  input: BeneficiarioInput,
  userId?: string
) {
  const data = validateInput(input);

  const { data: existing } = await supabase
    .from("beneficiarios")
    .select("id")
    .eq("cpf", data.cpf)
    .maybeSingle();

  if (existing) throw new Error("Já existe um beneficiário com este CPF");

  let provedorId = data.provedor_id;

  if (data.titular_id) {
    const { data: titular } = await supabase
      .from("beneficiarios")
      .select("id, perfil, provedor_id")
      .eq("id", data.titular_id)
      .single();
    if (!titular || titular.perfil !== "titular") {
      throw new Error("Titular informado não encontrado");
    }
    provedorId = titular.provedor_id ?? provedorId;
  }

  if (!provedorId) throw new Error("Selecione um provedor para o beneficiário");

  const { data: provedor } = await supabase
    .from("provedores")
    .select("id, cobrar_dependentes, valor_dependente")
    .eq("id", provedorId)
    .maybeSingle();

  if (!provedor) throw new Error("Provedor informado não encontrado");

  let titularJaCobra = false;
  if (data.perfil === "dependente" && data.titular_id) {
    titularJaCobra = await titularJaCobraDependentesNoBanco(supabase, data.titular_id);
  }

  const cobrarNaAssinatura =
    data.perfil === "dependente" &&
    shouldAutoCobrarNovoDependente({
      provedor,
      titularJaCobra,
      dependenteCobravel: isDependenteCobravelPorStatus({
        status_totalpass: data.status_totalpass,
      } as Beneficiario),
    });

  const gateway_pagamento =
    data.gateway_pagamento ??
    normalizeGateway(data.perfil, null);

  let asaasCustomerId: string | null = null;
  let asaasAviso: string | null = null;
  // Só cria cliente Asaas se o titular for do trilho Asaas (não Infinity).
  if (data.perfil === "titular" && gateway_pagamento === "asaas") {
    const asaasConfig = await getAsaasConfig(supabase);
    if (asaasConfig?.api_key) {
      try {
        const asaas = new AsaasClient(asaasConfig);
        const customer = await asaas.createCustomer({
          name: data.nome,
          cpfCnpj: data.cpf,
          email: data.email ?? undefined,
          mobilePhone: data.telefone ?? undefined,
          externalReference: data.cpf,
        });
        asaasCustomerId = customer.id;
      } catch (e) {
        // Não bloqueia o cadastro: o cliente no Asaas pode ser criado depois.
        asaasAviso = e instanceof Error ? e.message : "erro desconhecido";
      }
    }
  }

  const { data: created, error } = await supabase
    .from("beneficiarios")
    .insert({
      nome: data.nome,
      cpf: data.cpf,
      telefone: data.telefone,
      email: data.email,
      perfil: data.perfil,
      titular_id: data.titular_id,
      provedor_id: provedorId,
      status_totalpass: data.status_totalpass,
      plano: data.plano,
      data_aderido_totalpass: data.data_aderido_totalpass,
      observacoes: data.observacoes,
      asaas_customer_id: asaasCustomerId,
      gateway_pagamento,
      infinity_customer_id: data.infinity_customer_id ?? null,
      infinity_subscription_slug: data.infinity_subscription_slug ?? null,
      cobrar_na_assinatura: data.perfil === "dependente" ? cobrarNaAssinatura : true,
      data_cadastro_sistema: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "beneficiario_criado_manual",
    entidade: "beneficiarios",
    entidade_id: created.id,
    payload: {
      perfil: data.perfil,
      cpf: data.cpf,
      provedor_id: provedorId,
      gateway_pagamento,
      asaas_aviso: asaasAviso,
    },
  });

  if (data.perfil === "dependente" && data.titular_id) {
    try {
      await reconcileDependentBillingForTitular(supabase, data.titular_id, {
        userId,
        motivo: "dependente adicionado manualmente",
      });
    } catch {
      // Cadastro concluído; a assinatura pode ser reconciliada manualmente depois.
    }
  }

  return { ...created, _aviso_asaas: asaasAviso };
}

export async function updateBeneficiario(
  supabase: SupabaseClient,
  id: string,
  input: BeneficiarioInput,
  userId?: string
) {
  const data = validateInput(input);

  const { data: current } = await supabase
    .from("beneficiarios")
    .select("*")
    .eq("id", id)
    .single();

  if (!current) throw new Error("Beneficiário não encontrado");

  if (current.cpf !== data.cpf) {
    const { data: duplicate } = await supabase
      .from("beneficiarios")
      .select("id")
      .eq("cpf", data.cpf)
      .neq("id", id)
      .maybeSingle();
    if (duplicate) throw new Error("Já existe outro beneficiário com este CPF");
  }

  let provedorId = data.provedor_id;

  if (data.perfil === "dependente" && data.titular_id) {
    const { data: titular } = await supabase
      .from("beneficiarios")
      .select("id, perfil, provedor_id")
      .eq("id", data.titular_id)
      .single();
    if (!titular || titular.perfil !== "titular") {
      throw new Error("Titular informado não encontrado");
    }
    provedorId = titular.provedor_id ?? provedorId;
  }

  if (!provedorId) throw new Error("Selecione um provedor para o beneficiário");

  const { data: provedor } = await supabase
    .from("provedores")
    .select("id")
    .eq("id", provedorId)
    .maybeSingle();

  if (!provedor) throw new Error("Provedor informado não encontrado");

  const gateway_pagamento =
    data.perfil === "dependente"
      ? "nenhum"
      : (data.gateway_pagamento ??
        (current.gateway_pagamento as GatewayPagamento | null) ??
        "asaas");

  const patch: Record<string, unknown> = {
    nome: data.nome,
    cpf: data.cpf,
    telefone: data.telefone,
    email: data.email,
    perfil: data.perfil,
    titular_id: data.titular_id,
    provedor_id: provedorId,
    status_totalpass: data.status_totalpass,
    plano: data.plano,
    data_aderido_totalpass: data.data_aderido_totalpass,
    observacoes: data.observacoes,
    gateway_pagamento,
    updated_at: new Date().toISOString(),
  };

  if (data.infinity_customer_id !== undefined) {
    patch.infinity_customer_id = data.infinity_customer_id;
  } else if (data.perfil === "dependente") {
    patch.infinity_customer_id = null;
  }

  if (data.infinity_subscription_slug !== undefined) {
    patch.infinity_subscription_slug = data.infinity_subscription_slug;
  } else if (data.perfil === "dependente") {
    patch.infinity_subscription_slug = null;
  }

  const { data: updated, error } = await supabase
    .from("beneficiarios")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const provedorMudou =
    data.perfil === "titular" && current.provedor_id !== provedorId;

  // Troca de provedor: dependentes acompanham; fatura Asaas NÃO é recalculada.
  if (provedorMudou) {
    await cascadeProvedorToDependents(supabase, id, provedorId);
  }

  await createLog(supabase, {
    usuario_id: userId,
    acao: "beneficiario_atualizado",
    entidade: "beneficiarios",
    entidade_id: id,
    payload: {
      cpf: data.cpf,
      provedor_id: provedorId,
      provedor_anterior: provedorMudou ? current.provedor_id : undefined,
      gateway_pagamento,
      fatura_inalterada_por_provedor: provedorMudou || undefined,
    },
  });

  const titularesParaReconciliar = new Set<string>();
  // Não reconciliar fatura só por troca de provedor do titular.
  if (data.perfil === "dependente" && data.titular_id) {
    titularesParaReconciliar.add(data.titular_id);
  }
  if (current.perfil === "dependente" && current.titular_id) {
    titularesParaReconciliar.add(current.titular_id);
  }

  for (const titularId of titularesParaReconciliar) {
    try {
      await reconcileDependentBillingForTitular(supabase, titularId, {
        userId,
        motivo: "dependente atualizado manualmente",
      });
    } catch {
      // Atualização concluída; a assinatura pode ser reconciliada manualmente depois.
    }
  }

  return updated;
}

/**
 * Troca o provedor do titular e dos dependentes.
 * Não cria/cancela assinatura nem recalcula fatura Asaas — só o vínculo organizacional.
 */
export async function applyProvedorChange(
  supabase: SupabaseClient,
  params: {
    titularId: string;
    provedorId: string;
    userId?: string;
    origem?: string;
  }
) {
  const now = new Date().toISOString();
  const { data: titular, error: titErr } = await supabase
    .from("beneficiarios")
    .select("id, perfil, provedor_id, nome, cpf")
    .eq("id", params.titularId)
    .single();

  if (titErr || !titular) {
    throw new Error(titErr?.message ?? "Titular não encontrado");
  }
  if (titular.perfil !== "titular") {
    throw new Error("Só titulares podem mudar de provedor diretamente");
  }
  if (titular.provedor_id === params.provedorId) {
    return { changed: false, dependentes: 0 };
  }

  const { data: provedor } = await supabase
    .from("provedores")
    .select("id, nome")
    .eq("id", params.provedorId)
    .maybeSingle();
  if (!provedor) throw new Error("Provedor informado não encontrado");

  const { error: upTitular } = await supabase
    .from("beneficiarios")
    .update({ provedor_id: params.provedorId, updated_at: now })
    .eq("id", params.titularId);
  if (upTitular) throw new Error(upTitular.message);

  const { data: deps, error: depErr } = await supabase
    .from("beneficiarios")
    .update({ provedor_id: params.provedorId, updated_at: now })
    .eq("titular_id", params.titularId)
    .eq("perfil", "dependente")
    .select("id");
  if (depErr) throw new Error(depErr.message);

  await createLog(supabase, {
    usuario_id: params.userId,
    acao: "beneficiario_provedor_alterado",
    entidade: "beneficiarios",
    entidade_id: params.titularId,
    payload: {
      de: titular.provedor_id,
      para: params.provedorId,
      provedor_nome: provedor.nome,
      dependentes: deps?.length ?? 0,
      origem: params.origem ?? "manual",
      fatura_inalterada: true,
    },
  });

  return { changed: true, dependentes: deps?.length ?? 0 };
}

/** Só propaga provedor do titular → dependentes (sem reconciliar fatura). */
export async function cascadeProvedorToDependents(
  supabase: SupabaseClient,
  titularId: string,
  provedorId: string
) {
  const now = new Date().toISOString();
  await supabase
    .from("beneficiarios")
    .update({ provedor_id: provedorId, updated_at: now })
    .eq("titular_id", titularId)
    .eq("perfil", "dependente");
}

async function removeBeneficiarioLocal(
  supabase: SupabaseClient,
  id: string,
  asaas: AsaasClient | null,
  options?: { notificarCancelamento?: boolean; userId?: string }
) {
  await cancelActiveSubscriptionsForBeneficiario(supabase, id, {
    notificar: options?.notificarCancelamento ?? false,
    userId: options?.userId,
  });

  // Ordem obrigatória por FK: cobrancas → assinaturas → beneficiario.
  // Apaga cobranças tanto pelo beneficiário quanto pelas assinaturas dele
  // (evita falha se houver vínculo só via assinatura_id).
  const { data: assinaturas, error: assinaturasQueryError } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("beneficiario_id", id);

  if (assinaturasQueryError) {
    throw new Error(
      `Erro ao localizar assinaturas: ${assinaturasQueryError.message}`
    );
  }

  const assinaturaIds = (assinaturas ?? []).map((a) => a.id);

  if (assinaturaIds.length > 0) {
    const { error: cobrancasAssinaturaError } = await supabase
      .from("cobrancas")
      .delete()
      .in("assinatura_id", assinaturaIds);
    if (cobrancasAssinaturaError) {
      throw new Error(
        `Erro ao remover cobranças vinculadas à assinatura: ${cobrancasAssinaturaError.message}`
      );
    }
  }

  const { error: cobrancasError } = await supabase
    .from("cobrancas")
    .delete()
    .eq("beneficiario_id", id);
  if (cobrancasError) {
    throw new Error(`Erro ao remover cobranças: ${cobrancasError.message}`);
  }

  const { error: mensagensError } = await supabase
    .from("mensagens")
    .delete()
    .eq("beneficiario_id", id);
  if (mensagensError) {
    throw new Error(`Erro ao remover mensagens: ${mensagensError.message}`);
  }

  const { error: assinaturasError } = await supabase
    .from("assinaturas")
    .delete()
    .eq("beneficiario_id", id);
  if (assinaturasError) {
    throw new Error(
      `Erro ao remover assinaturas: ${assinaturasError.message}`
    );
  }

  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("asaas_customer_id, perfil")
    .eq("id", id)
    .single();

  if (asaas && beneficiario?.asaas_customer_id && beneficiario.perfil === "titular") {
    try {
      await asaas.deleteCustomer(beneficiario.asaas_customer_id);
    } catch {
      // Remove do sistema mesmo se o cliente já não existir no Asaas.
    }
  }

  const { error } = await supabase.from("beneficiarios").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteBeneficiario(
  supabase: SupabaseClient,
  id: string,
  userId?: string,
  options?: { notificarCancelamento?: boolean }
) {
  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("*")
    .eq("id", id)
    .single();

  if (!beneficiario) throw new Error("Beneficiário não encontrado");

  const asaasConfig = await getAsaasConfig(supabase);
  const asaas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;

  if (beneficiario.perfil === "titular") {
    const { data: dependentes } = await supabase
      .from("beneficiarios")
      .select("id")
      .eq("titular_id", id);

    for (const dependente of dependentes ?? []) {
      await removeBeneficiarioLocal(supabase, dependente.id, null, { userId });
      await createLog(supabase, {
        usuario_id: userId,
        acao: "beneficiario_excluido",
        entidade: "beneficiarios",
        entidade_id: dependente.id,
        payload: { motivo: "exclusao_titular", titular_id: id },
      });
    }
  }

  await removeBeneficiarioLocal(supabase, id, asaas, {
    notificarCancelamento: options?.notificarCancelamento,
    userId,
  });

  await createLog(supabase, {
    usuario_id: userId,
    acao: "beneficiario_excluido",
    entidade: "beneficiarios",
    entidade_id: id,
    payload: { cpf: beneficiario.cpf, perfil: beneficiario.perfil },
  });

  return { id, dependentesRemovidos: beneficiario.perfil === "titular" };
}

export async function deleteBeneficiarios(
  supabase: SupabaseClient,
  ids: string[],
  userId?: string,
  options?: { notificarCancelamento?: boolean }
) {
  if (!ids.length) throw new Error("Nenhum beneficiário selecionado");

  const { data: beneficiarios } = await supabase
    .from("beneficiarios")
    .select("id, perfil, titular_id")
    .in("id", ids);

  if (!beneficiarios?.length) throw new Error("Nenhum beneficiário encontrado");

  const selected = new Set(ids);
  const titulares = beneficiarios.filter((b) => b.perfil === "titular");
  const titularIds = new Set(titulares.map((t) => t.id));

  // Evita excluir dependente duas vezes quando o titular também foi selecionado.
  const dependentes = beneficiarios.filter(
    (b) =>
      b.perfil === "dependente" &&
      (!b.titular_id || !titularIds.has(b.titular_id))
  );

  const ordem = [...titulares.map((t) => t.id), ...dependentes.map((d) => d.id)];
  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const id of ordem) {
    if (!selected.has(id)) continue;
    try {
      await deleteBeneficiario(supabase, id, userId, options);
      results.push({ id, success: true });
    } catch (e) {
      results.push({
        id,
        success: false,
        error: e instanceof Error ? e.message : "Erro",
      });
    }
  }

  return results;
}
