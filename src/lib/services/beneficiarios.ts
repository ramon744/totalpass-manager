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
import type { Beneficiario, PerfilBeneficiario, StatusTotalpass } from "@/types/database";

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

  let asaasCustomerId: string | null = null;
  let asaasAviso: string | null = null;
  if (data.perfil === "titular") {
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

  const { data: updated, error } = await supabase
    .from("beneficiarios")
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "beneficiario_atualizado",
    entidade: "beneficiarios",
    entidade_id: id,
    payload: { cpf: data.cpf, provedor_id: provedorId },
  });

  const titularesParaReconciliar = new Set<string>();
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

  await supabase.from("cobrancas").delete().eq("beneficiario_id", id);
  await supabase.from("mensagens").delete().eq("beneficiario_id", id);
  await supabase.from("assinaturas").delete().eq("beneficiario_id", id);

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
