import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AsaasClient,
  nextDueDateFromDay,
  mapAsaasSubscriptionStatus,
  normalizeSubscriptionStatus,
} from "@/lib/asaas/client";
import { getAsaasConfig, getFinanceiroConfig } from "@/lib/config";
import { getFormaPagamentoPadrao } from "@/lib/assinatura-billing";
import { createLog } from "@/lib/logger";
import { wasRecentlyUpdated } from "@/lib/sync-grace";
import { drainMessageQueue, scheduleMessage } from "@/lib/services/messages";
import { scheduleCatchUpPaymentReminder } from "@/lib/services/reminder-catchup";
import {
  cancelOpenCobrancasForBeneficiario,
} from "@/lib/services/cobrancas";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import { isValidPhone, sanitizePhone } from "@/lib/validators/phone";
import {
  calculateDependentBilling,
  diffDependentesCobrados,
  formatDependentesCobranca,
  formatMoneyValue,
  syncCobrancaAutomaticaDependentesDoTitular,
} from "@/lib/dependent-billing";
import type {
  Beneficiario,
  DependenteCobrancaSnapshot,
  Provedor,
} from "@/types/database";

export interface AsaasSubscriptionPayload {
  id: string;
  customer: string;
  status: string;
  value?: number;
  nextDueDate?: string;
  description?: string;
  externalReference?: string;
}

async function findBeneficiarioForAsaasSubscription(
  supabase: SupabaseClient,
  subscription: AsaasSubscriptionPayload,
  asaas?: AsaasClient
) {
  const { data: byCustomer } = await supabase
    .from("beneficiarios")
    .select("id, asaas_customer_id, provedor_id, nome, cpf")
    .eq("asaas_customer_id", subscription.customer)
    .eq("perfil", "titular")
    .not("provedor_id", "is", null)
    .maybeSingle();

  if (byCustomer) return byCustomer;

  if (subscription.externalReference) {
    const { data: byRef } = await supabase
      .from("beneficiarios")
      .select("id, asaas_customer_id, provedor_id, nome, cpf")
      .eq("id", subscription.externalReference)
      .eq("perfil", "titular")
      .not("provedor_id", "is", null)
      .maybeSingle();

    if (byRef) {
      if (!byRef.asaas_customer_id) {
        await supabase
          .from("beneficiarios")
          .update({
            asaas_customer_id: subscription.customer,
            updated_at: new Date().toISOString(),
          })
          .eq("id", byRef.id);
      }
      return byRef;
    }
  }

  if (asaas) {
    try {
      const customer = await asaas.getCustomer(subscription.customer);
      const cpf = (customer.cpfCnpj ?? "").replace(/\D/g, "");
      if (cpf) {
        const { data: byCpf } = await supabase
          .from("beneficiarios")
          .select("id, asaas_customer_id, provedor_id, nome, cpf")
          .eq("cpf", cpf)
          .eq("perfil", "titular")
          .not("provedor_id", "is", null)
          .maybeSingle();

        if (byCpf) {
          if (!byCpf.asaas_customer_id) {
            await supabase
              .from("beneficiarios")
              .update({
                asaas_customer_id: subscription.customer,
                updated_at: new Date().toISOString(),
              })
              .eq("id", byCpf.id);
          }
          return byCpf;
        }
      }
    } catch {
      // Cliente não encontrado no Asaas.
    }
  }

  return null;
}

async function upsertAssinaturaFromAsaasRemote(
  supabase: SupabaseClient,
  subscription: AsaasSubscriptionPayload,
  beneficiarioId: string,
  status: string
) {
  const { data: existing } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("asaas_subscription_id", subscription.id)
    .maybeSingle();

  const valor = Number(subscription.value) || 0;
  const diaVencimento = subscription.nextDueDate
    ? Number(subscription.nextDueDate.split("-")[2])
    : 10;

  const payload = {
    beneficiario_id: beneficiarioId,
    asaas_subscription_id: subscription.id,
    valor: valor > 0 ? valor : 0,
    dia_vencimento: diaVencimento >= 1 && diaVencimento <= 28 ? diaVencimento : 10,
    proximo_vencimento: subscription.nextDueDate ?? null,
    descricao: subscription.description?.trim() || "Assinatura Asaas",
    status,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("assinaturas").update(payload).eq("id", existing.id);
    return existing.id;
  }

  if (status !== "ACTIVE") return null;

  const { data: created } = await supabase
    .from("assinaturas")
    .insert({
      ...payload,
      data_criacao: new Date().toISOString(),
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

/** Importa assinatura criada/atualizada no Asaas para beneficiário vinculado a provedor. */
export async function handleAsaasSubscriptionWebhook(
  supabase: SupabaseClient,
  event: string,
  subscription: AsaasSubscriptionPayload
) {
  const status =
    event === "SUBSCRIPTION_DELETED"
      ? "CANCELLED"
      : normalizeSubscriptionStatus(subscription.status);

  const { data: existing } = await supabase
    .from("assinaturas")
    .select("id, beneficiario_id")
    .eq("asaas_subscription_id", subscription.id)
    .maybeSingle();

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (subscription.value != null) {
      updatePayload.valor = Number(subscription.value);
    }
    if (subscription.nextDueDate) {
      updatePayload.proximo_vencimento = subscription.nextDueDate;
      const dia = Number(subscription.nextDueDate.split("-")[2]);
      if (dia >= 1 && dia <= 28) updatePayload.dia_vencimento = dia;
    }
    if (subscription.description?.trim()) {
      updatePayload.descricao = subscription.description.trim();
    }

    await supabase.from("assinaturas").update(updatePayload).eq("id", existing.id);

    if (status === "CANCELLED") {
      await scheduleMessage(supabase, {
        evento: "assinatura_cancelada",
        beneficiarioId: existing.beneficiario_id,
        vars: { nome: "" },
        refId: existing.id,
      });
    }
    return;
  }

  if (status !== "ACTIVE") return;

  const asaasConfig = await getAsaasConfig(supabase);
  const asaas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : undefined;

  const beneficiario = await findBeneficiarioForAsaasSubscription(
    supabase,
    subscription,
    asaas
  );
  if (!beneficiario) return;

  const assinaturaId = await upsertAssinaturaFromAsaasRemote(
    supabase,
    subscription,
    beneficiario.id,
    status
  );

  if (assinaturaId) {
    await createLog(supabase, {
      acao: "assinatura_importada_asaas",
      entidade: "assinaturas",
      entidade_id: assinaturaId,
      payload: {
        evento: event,
        asaas_subscription_id: subscription.id,
        beneficiario_id: beneficiario.id,
      },
    });
  }
}

/** Sincroniza assinaturas locais marcadas como ACTIVE com o status real no Asaas. */
export async function syncActiveSubscriptionsFromAsaas(
  supabase: SupabaseClient,
  options?: { beneficiarioId?: string }
) {
  const asaasConfig = await getAsaasConfig(supabase);
  if (!asaasConfig?.api_key) return;

  let query = supabase
    .from("assinaturas")
    .select("id, asaas_subscription_id, valor, dia_vencimento, proximo_vencimento, status, updated_at")
    .eq("status", "ACTIVE");

  if (options?.beneficiarioId) {
    query = query.eq("beneficiario_id", options.beneficiarioId);
  }

  const { data: ativas } = await query;
  if (!ativas?.length) return;

  const asaas = new AsaasClient(asaasConfig);

  for (const local of ativas) {
    if (!local.asaas_subscription_id) continue;

    try {
      const remote = await asaas.getSubscription(local.asaas_subscription_id);
      const status = normalizeSubscriptionStatus(remote.status);

      // Só grava quando algo realmente mudou. Escrever updated_at à toa
      // dispararia o realtime e causaria refresh em loop na tela.
      const updatePayload: Record<string, unknown> = {};

      if (remote.value != null && Number(remote.value) !== Number(local.valor)) {
        updatePayload.valor = Number(remote.value);
      }
      if (remote.nextDueDate && !wasRecentlyUpdated(local.updated_at)) {
        if (remote.nextDueDate !== local.proximo_vencimento) {
          updatePayload.proximo_vencimento = remote.nextDueDate;
        }
        const dia = Number(remote.nextDueDate.split("-")[2]);
        if (dia >= 1 && dia <= 28 && dia !== local.dia_vencimento) {
          updatePayload.dia_vencimento = dia;
        }
      }
      if (status !== "ACTIVE" && status !== local.status) {
        updatePayload.status = status;
      }

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updated_at = new Date().toISOString();
        await supabase.from("assinaturas").update(updatePayload).eq("id", local.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (
        msg.includes("404") ||
        msg.includes("não encontrad") ||
        msg.includes("not found") ||
        msg.includes("inexistente")
      ) {
        await supabase
          .from("assinaturas")
          .update({
            status: "CANCELLED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", local.id);
      }
    }
  }
}

/** Importa assinaturas ativas do Asaas que ainda não existem no app. */
export async function importMissingSubscriptionsFromAsaas(
  supabase: SupabaseClient,
  options?: { beneficiarioId?: string }
) {
  const asaasConfig = await getAsaasConfig(supabase);
  if (!asaasConfig?.api_key) return;

  let query = supabase
    .from("beneficiarios")
    .select("id, asaas_customer_id")
    .eq("perfil", "titular")
    .not("provedor_id", "is", null)
    .not("asaas_customer_id", "is", null);

  if (options?.beneficiarioId) {
    query = query.eq("id", options.beneficiarioId);
  }

  const { data: beneficiarios } = await query;
  if (!beneficiarios?.length) return;

  const asaas = new AsaasClient(asaasConfig);

  for (const beneficiario of beneficiarios) {
    if (!beneficiario.asaas_customer_id) continue;

    try {
      const remote = await asaas.listSubscriptionsByCustomer(
        beneficiario.asaas_customer_id,
        "ACTIVE"
      );

      for (const sub of remote.data ?? []) {
        const { data: exists } = await supabase
          .from("assinaturas")
          .select("id")
          .eq("asaas_subscription_id", sub.id)
          .maybeSingle();

        if (!exists) {
          await upsertAssinaturaFromAsaasRemote(
            supabase,
            { ...sub, customer: beneficiario.asaas_customer_id },
            beneficiario.id,
            "ACTIVE"
          );
        }
      }
    } catch {
      // Ignora falha pontual de um cliente na sincronização.
    }
  }

  // Beneficiários com provedor mas sem vínculo Asaas: tenta achar pelo CPF no painel.
  if (!options?.beneficiarioId) {
    const { data: semVinculo } = await supabase
      .from("beneficiarios")
      .select("id, cpf")
      .eq("perfil", "titular")
      .not("provedor_id", "is", null)
      .is("asaas_customer_id", null)
      .limit(50);

    for (const b of semVinculo ?? []) {
      try {
        const customers = await asaas.findCustomerByCpf(b.cpf);
        const customer = customers.data?.[0];
        if (!customer) continue;

        await supabase
          .from("beneficiarios")
          .update({
            asaas_customer_id: customer.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", b.id);

        const remote = await asaas.listSubscriptionsByCustomer(customer.id, "ACTIVE");
        for (const sub of remote.data ?? []) {
          const { data: exists } = await supabase
            .from("assinaturas")
            .select("id")
            .eq("asaas_subscription_id", sub.id)
            .maybeSingle();

          if (!exists) {
            await upsertAssinaturaFromAsaasRemote(
              supabase,
              { ...sub, customer: customer.id },
              b.id,
              "ACTIVE"
            );
          }
        }
      } catch {
        // Ignora falha pontual.
      }
    }
  }
}

/** Sincronização bidirecional com o Asaas (cancelamentos + importações). */
export async function syncSubscriptionsFromAsaas(
  supabase: SupabaseClient,
  options?: { beneficiarioId?: string }
) {
  await syncActiveSubscriptionsFromAsaas(supabase, options);
  await importMissingSubscriptionsFromAsaas(supabase, options);
}

function isEditableOpenPayment(payment: { status: string }) {
  return payment.status === "PENDING" || payment.status === "OVERDUE";
}

async function getTitularBillingData(supabase: SupabaseClient, titularId: string) {
  const { data: titular } = await supabase
    .from("beneficiarios")
    .select("*")
    .eq("id", titularId)
    .eq("perfil", "titular")
    .single();

  if (!titular) throw new Error("Titular não encontrado");

  const [{ data: dependentes }, { data: provedor }] = await Promise.all([
    supabase
      .from("beneficiarios")
      .select("*")
      .eq("titular_id", titularId)
      .eq("perfil", "dependente")
      .order("nome"),
    titular.provedor_id
      ? supabase.from("provedores").select("*").eq("id", titular.provedor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    titular: titular as Beneficiario,
    dependentes: (dependentes ?? []) as Beneficiario[],
    provedor: provedor as Provedor | null,
  };
}

function resolveValorDependenteFallback(assinatura: {
  dependentes_cobrados?: DependenteCobrancaSnapshot[] | null;
  valor_dependentes?: number | null;
}) {
  const cobrados = (assinatura.dependentes_cobrados ??
    []) as DependenteCobrancaSnapshot[];
  if (cobrados[0]?.valor != null && Number(cobrados[0].valor) > 0) {
    return Number(cobrados[0].valor);
  }
  if (Number(assinatura.valor_dependentes) > 0 && cobrados.length > 0) {
    return Number(assinatura.valor_dependentes) / cobrados.length;
  }
  return 0;
}

async function applyDependentSelection(
  supabase: SupabaseClient,
  titularId: string,
  selectedIds: string[] | null | undefined,
  userId?: string
) {
  if (!selectedIds) return;

  const { data: dependentes } = await supabase
    .from("beneficiarios")
    .select("id")
    .eq("titular_id", titularId)
    .eq("perfil", "dependente");

  const selected = new Set(selectedIds);
  const now = new Date().toISOString();

  await Promise.all(
    (dependentes ?? []).map((d) => {
      const cobrar = selected.has(d.id);
      return supabase
        .from("beneficiarios")
        .update({
          cobrar_na_assinatura: cobrar,
          cobranca_manual_desativada_em: cobrar ? null : now,
          cobranca_manual_desativada_por: cobrar ? null : userId ?? null,
          cobranca_manual_motivo: cobrar ? null : "Desativado na assinatura",
          updated_at: now,
        })
        .eq("id", d.id);
    })
  );
}

async function notifyDependentBillingChanges(
  supabase: SupabaseClient,
  params: {
    titularId: string;
    adicionados: DependenteCobrancaSnapshot[];
    removidos: DependenteCobrancaSnapshot[];
    valorDependente: number;
    valorDependentes: number;
    valorTotal: number;
    vigencia: string;
    motivo: string;
    retomadosIds?: Set<string>;
  }
) {
  const baseVars = {
    valor_dependente: formatMoneyValue(params.valorDependente),
    valor_dependentes: formatMoneyValue(params.valorDependentes),
    valor_total: formatMoneyValue(params.valorTotal),
    vigencia: params.vigencia,
    motivo: params.motivo,
  };

  const adicionadosNovos = params.adicionados.filter(
    (d) => !params.retomadosIds?.has(d.id)
  );
  const retomados = params.adicionados.filter((d) => params.retomadosIds?.has(d.id));

  if (adicionadosNovos.length) {
    await scheduleMessage(supabase, {
      evento: "dependente_cobranca_iniciada",
      beneficiarioId: params.titularId,
      vars: { ...baseVars, dependentes: formatDependentesCobranca(adicionadosNovos) },
    });
  }

  if (retomados.length) {
    await scheduleMessage(supabase, {
      evento: "dependente_cobranca_retomada",
      beneficiarioId: params.titularId,
      vars: { ...baseVars, dependentes: formatDependentesCobranca(retomados) },
    });
  }

  if (params.removidos.length) {
    await scheduleMessage(supabase, {
      evento: "dependente_cobranca_parada",
      beneficiarioId: params.titularId,
      vars: { ...baseVars, dependentes: formatDependentesCobranca(params.removidos) },
    });
  }
}

export async function reconcileDependentBillingForTitular(
  supabase: SupabaseClient,
  titularId: string,
  options: {
    userId?: string;
    motivo?: string;
    dependentesCobrancaIds?: string[] | null;
    retomadosIds?: string[];
    notificar?: boolean;
  } = {}
) {
  if (options.dependentesCobrancaIds) {
    await applyDependentSelection(
      supabase,
      titularId,
      options.dependentesCobrancaIds,
      options.userId
    );
  }

  await syncCobrancaAutomaticaDependentesDoTitular(supabase, titularId);

  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select("*")
    .eq("beneficiario_id", titularId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (!assinatura) return null;

  const [{ titular, dependentes, provedor }, financeiro] = await Promise.all([
    getTitularBillingData(supabase, titularId),
    getFinanceiroConfig(supabase),
  ]);

  const calculated = calculateDependentBilling({
    titular,
    dependentes,
    provedor,
    defaults: {
      valor: financeiro?.valor_mensalidade_padrao ?? Number(assinatura.valor) ?? 0,
      descricao:
        provedor?.mensagem_padrao?.trim() ||
        assinatura.descricao ||
        financeiro?.descricao_padrao ||
        "Mensalidade TotalPass",
    },
    valorDependenteFallback: resolveValorDependenteFallback(assinatura),
  });

  const previous = (assinatura.dependentes_cobrados ??
    []) as DependenteCobrancaSnapshot[];
  const diff = diffDependentesCobrados(previous, calculated.dependentesCobrados);

  const updateResult = await updateSubscription(
    supabase,
    assinatura.id,
    {
      valor: calculated.valorTotal,
      descricao: calculated.descricao,
      cobrarDependentes: calculated.cobrarDependentes,
      valorTitular: calculated.valorTitular,
      valorDependentes: calculated.valorDependentes,
      dependentesCobrados: calculated.dependentesCobrados,
    },
    options.userId
  );

  if (
    options.notificar !== false &&
    calculated.cobrarDependentes &&
    (diff.adicionados.length || diff.removidos.length)
  ) {
    await notifyDependentBillingChanges(supabase, {
      titularId,
      adicionados: diff.adicionados,
      removidos: diff.removidos,
      valorDependente: calculated.valorDependente,
      valorDependentes: calculated.valorDependentes,
      valorTotal: calculated.valorTotal,
      vigencia: updateResult.updatedCurrentPayment
        ? "nesta fatura"
        : "na próxima fatura",
      motivo: options.motivo ?? "atualização de dependentes",
      retomadosIds: new Set(options.retomadosIds ?? []),
    });
  }

  return {
    ...calculated,
    diff,
    updatedCurrentPayment: updateResult.updatedCurrentPayment,
  };
}

/** Alinha dependentes elegíveis quando o titular já possui algum dependente na cobrança. */
export async function reconcileTitularesComDependentesCobrando(
  supabase: SupabaseClient,
  options: { userId?: string; notificar?: boolean } = {}
) {
  const { data: deps } = await supabase
    .from("beneficiarios")
    .select("titular_id")
    .eq("perfil", "dependente")
    .eq("cobrar_na_assinatura", true)
    .in("status_totalpass", ["ativo", "elegivel"])
    .not("titular_id", "is", null);

  const titularIds = [
    ...new Set((deps ?? []).map((d) => d.titular_id).filter(Boolean) as string[]),
  ];

  for (const titularId of titularIds) {
    try {
      await reconcileDependentBillingForTitular(supabase, titularId, {
        userId: options.userId,
        motivo: "sincronização de cobrança de dependentes",
        notificar: options.notificar ?? false,
      });
    } catch {
      // Segue para os demais titulares.
    }
  }
}

export async function hasActiveSubscription(
  supabase: SupabaseClient,
  beneficiarioId: string
) {
  const { data } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("beneficiario_id", beneficiarioId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  return !!data;
}

export async function createSubscription(
  supabase: SupabaseClient,
  params: {
    beneficiarioId: string;
    valor: number;
    diaVencimento: number;
    nextDueDate?: string;
    descricao: string;
    nome?: string;
    telefone?: string | null;
    dependentesCobrancaIds?: string[] | null;
    userId?: string;
  }
) {
  const { data: beneficiario, error } = await supabase
    .from("beneficiarios")
    .select("*")
    .eq("id", params.beneficiarioId)
    .single();

  if (error || !beneficiario) {
    throw new Error("Beneficiário não encontrado");
  }

  await syncSubscriptionsFromAsaas(supabase, {
    beneficiarioId: params.beneficiarioId,
  });

  if (await hasActiveSubscription(supabase, params.beneficiarioId)) {
    throw new Error("Este cliente já possui assinatura ativa.");
  }

  if (params.dependentesCobrancaIds) {
    await applyDependentSelection(
      supabase,
      params.beneficiarioId,
      params.dependentesCobrancaIds,
      params.userId
    );
  }

  const asaasConfig = await getAsaasConfig(supabase);
  if (!asaasConfig?.api_key) {
    throw new Error("Configure a API do Asaas nas configurações");
  }

  // Permite revisar/corrigir nome e telefone no momento da assinatura.
  const nomeFinal = params.nome?.trim() || beneficiario.nome;
  const telefoneBruto =
    params.telefone !== undefined ? params.telefone : beneficiario.telefone;
  const telefoneFinal = telefoneBruto ? sanitizePhone(telefoneBruto) : null;

  if (!telefoneFinal || !isValidPhone(telefoneFinal)) {
    throw new Error(
      "WhatsApp é obrigatório para criar assinatura. Informe um telefone válido."
    );
  }

  if (nomeFinal !== beneficiario.nome || telefoneFinal !== beneficiario.telefone) {
    await supabase
      .from("beneficiarios")
      .update({
        nome: nomeFinal,
        telefone: telefoneFinal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.beneficiarioId);
  }

  const asaas = new AsaasClient(asaasConfig);

  let customerId = beneficiario.asaas_customer_id;
  if (!customerId) {
    const customer = await asaas.createCustomer({
      name: nomeFinal,
      cpfCnpj: beneficiario.cpf,
      email: beneficiario.email ?? undefined,
      mobilePhone: telefoneFinal ?? undefined,
      externalReference: beneficiario.cpf,
    });
    customerId = customer.id;
    await supabase
      .from("beneficiarios")
      .update({ asaas_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("id", params.beneficiarioId);
  }

  try {
    await asaas.disableCustomerNotifications(customerId);
  } catch {
    // Não bloqueia a assinatura se o Asaas não aceitar a atualização do cliente.
  }

  const remote = await asaas.listSubscriptionsByCustomer(customerId);
  if (remote.data?.length > 0) {
    throw new Error("Este cliente já possui assinatura ativa.");
  }

  const nextDueDate = params.nextDueDate ?? nextDueDateFromDay(params.diaVencimento);
  const diaVencimento = params.nextDueDate
    ? Number(params.nextDueDate.split("-")[2])
    : params.diaVencimento;

  const [financeiro, billingData] = await Promise.all([
    getFinanceiroConfig(supabase),
    getTitularBillingData(supabase, params.beneficiarioId),
  ]);
  const billingType = getFormaPagamentoPadrao(financeiro);
  const dependentBilling = calculateDependentBilling({
    titular: billingData.titular,
    dependentes: billingData.dependentes,
    provedor: billingData.provedor,
    defaults: {
      valor: params.valor,
      descricao: params.descricao,
    },
  });
  const finalValor = dependentBilling.cobrarDependentes
    ? dependentBilling.valorTotal
    : params.valor;
  const finalDescricao = dependentBilling.cobrarDependentes
    ? dependentBilling.descricao
    : params.descricao;

  const subscription = await asaas.createSubscription({
    customer: customerId,
    billingType,
    value: finalValor,
    nextDueDate,
    cycle: "MONTHLY",
    description: finalDescricao,
    externalReference: beneficiario.id,
  });

  const { data: assinatura, error: insertError } = await supabase
    .from("assinaturas")
    .insert({
      beneficiario_id: params.beneficiarioId,
      asaas_subscription_id: subscription.id,
      valor: finalValor,
      dia_vencimento: diaVencimento,
      proximo_vencimento: nextDueDate,
      descricao: finalDescricao,
      cobrar_dependentes: dependentBilling.cobrarDependentes,
      valor_titular: dependentBilling.cobrarDependentes
        ? dependentBilling.valorTitular
        : finalValor,
      valor_dependentes: dependentBilling.cobrarDependentes
        ? dependentBilling.valorDependentes
        : 0,
      dependentes_cobrados: dependentBilling.cobrarDependentes
        ? dependentBilling.dependentesCobrados
        : [],
      status: mapAsaasSubscriptionStatus(subscription.status),
      data_criacao: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) throw insertError;

  await createLog(supabase, {
    usuario_id: params.userId,
    acao: "assinatura_criada",
    entidade: "assinaturas",
    entidade_id: assinatura.id,
    payload: {
      valor: finalValor,
      dia: diaVencimento,
      nextDueDate,
      dependentes: dependentBilling.dependentesCobrados,
    },
  });

  const valorFmt = finalValor.toFixed(2).replace(".", ",");
  let paymentVars: Record<string, string> = {
    data_vencimento: nextDueDate.split("-").reverse().join("/"),
    link_fatura: "",
    codigo_pix: "",
    linha_digitavel: "",
  };
  let pendingPayment: { id: string; dueDate: string; value: number | string } | null =
    null;

  try {
    const pending = await asaas.listPaymentsByCustomer(customerId, "PENDING");
    const payment = pending.data?.[0];
    if (payment) {
      pendingPayment = payment;
      paymentVars = await buildPaymentTemplateVars(supabase, payment.id, {
        nome: nomeFinal,
        valor: valorFmt,
        data_vencimento: payment.dueDate.split("-").reverse().join("/"),
      });
    }
  } catch {
    // Primeira cobrança ainda não gerada no Asaas; envia sem PIX/boleto.
  }

  await scheduleMessage(supabase, {
    evento: "assinatura_criada",
    beneficiarioId: params.beneficiarioId,
    vars: {
      nome: nomeFinal,
      valor: valorFmt,
      vencimento: String(diaVencimento),
      ...paymentVars,
    },
    asaasPaymentId: pendingPayment?.id ?? null,
    refId: pendingPayment?.id ?? subscription.id,
  });

  if (pendingPayment) {
    await scheduleCatchUpPaymentReminder(supabase, {
      beneficiarioId: params.beneficiarioId,
      vencimento: pendingPayment.dueDate,
      valor: pendingPayment.value,
      status: "PENDING",
      asaasPaymentId: pendingPayment.id,
      nome: nomeFinal,
    });
  }

  return assinatura;
}

export async function cancelActiveSubscriptionsForBeneficiario(
  supabase: SupabaseClient,
  beneficiarioId: string,
  options?: { notificar?: boolean; userId?: string; motivo?: string }
) {
  const notificar = options?.notificar ?? false;
  const motivo = options?.motivo ?? "exclusao_beneficiario";

  const { data: beneficiario } = await supabase
    .from("beneficiarios")
    .select("id, nome, telefone")
    .eq("id", beneficiarioId)
    .maybeSingle();

  const { data: assinaturas } = await supabase
    .from("assinaturas")
    .select("id, asaas_subscription_id")
    .eq("beneficiario_id", beneficiarioId)
    .eq("status", "ACTIVE");

  const asaasConfig = await getAsaasConfig(supabase);
  const asaas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;

  if (!assinaturas?.length) {
    await cancelOpenCobrancasForBeneficiario(supabase, beneficiarioId, { asaas });
    return { cancelled: 0 };
  }

  for (const assinatura of assinaturas) {
    if (asaas) {
      try {
        await asaas.cancelSubscription(assinatura.asaas_subscription_id);
      } catch {
        // Continua mesmo se o Asaas falhar.
      }
    }

    await supabase
      .from("assinaturas")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", assinatura.id);

    await createLog(supabase, {
      usuario_id: options?.userId,
      acao: "assinatura_cancelada",
      entidade: "assinaturas",
      entidade_id: assinatura.id,
      payload: { motivo },
    });

    if (notificar && beneficiario?.id) {
      await scheduleMessage(supabase, {
        evento: "assinatura_cancelada",
        beneficiarioId: beneficiario.id,
        vars: { nome: beneficiario.nome },
        refId: assinatura.id,
      });
    }
  }

  await cancelOpenCobrancasForBeneficiario(supabase, beneficiarioId, { asaas });

  if (notificar && beneficiario?.id) {
    try {
      await drainMessageQueue(supabase);
    } catch {
      // Mensagem permanece na fila para retry manual/cron.
    }
  }

  return { cancelled: assinaturas.length };
}

export async function cancelSubscription(
  supabase: SupabaseClient,
  assinaturaId: string,
  userId?: string
) {
  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select("*, beneficiario:beneficiarios(*)")
    .eq("id", assinaturaId)
    .single();

  if (!assinatura) throw new Error("Assinatura não encontrada");

  const asaasConfig = await getAsaasConfig(supabase);
  if (asaasConfig?.api_key) {
    const asaas = new AsaasClient(asaasConfig);
    await asaas.cancelSubscription(assinatura.asaas_subscription_id);
  }

  await supabase
    .from("assinaturas")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", assinaturaId);

  const beneficiario = Array.isArray(assinatura.beneficiario)
    ? assinatura.beneficiario[0]
    : assinatura.beneficiario;

  if (beneficiario?.id) {
    const asaasForCobrancas = asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;
    await cancelOpenCobrancasForBeneficiario(supabase, beneficiario.id, {
      asaas: asaasForCobrancas,
      assinaturaId,
    });
  }

  await createLog(supabase, {
    usuario_id: userId,
    acao: "assinatura_cancelada",
    entidade: "assinaturas",
    entidade_id: assinaturaId,
  });

  if (beneficiario?.id) {
    await scheduleMessage(supabase, {
      evento: "assinatura_cancelada",
      beneficiarioId: beneficiario.id,
      vars: { nome: beneficiario.nome },
      refId: assinaturaId,
    });
  }

  try {
    await drainMessageQueue(supabase);
  } catch {
    // Cancelamento concluído; mensagem permanece na fila para retry manual/cron.
  }
}

export async function updateSubscription(
  supabase: SupabaseClient,
  assinaturaId: string,
  updates: {
    valor?: number;
    nextDueDate?: string;
    descricao?: string;
    cobrarDependentes?: boolean;
    valorTitular?: number;
    valorDependentes?: number;
    dependentesCobrados?: DependenteCobrancaSnapshot[];
  },
  userId?: string
) {
  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select("*")
    .eq("id", assinaturaId)
    .single();

  if (!assinatura) throw new Error("Assinatura não encontrada");

  const now = new Date().toISOString();
  const dbUpdate: Record<string, unknown> = { updated_at: now };
  if (updates.valor != null && updates.valor > 0) dbUpdate.valor = updates.valor;
  if (updates.descricao?.trim()) dbUpdate.descricao = updates.descricao.trim();
  if (updates.cobrarDependentes != null) {
    dbUpdate.cobrar_dependentes = updates.cobrarDependentes;
  }
  if (updates.valorTitular != null) dbUpdate.valor_titular = updates.valorTitular;
  if (updates.valorDependentes != null) {
    dbUpdate.valor_dependentes = updates.valorDependentes;
  }
  if (updates.dependentesCobrados) {
    dbUpdate.dependentes_cobrados = updates.dependentesCobrados;
  }
  if (updates.nextDueDate) {
    dbUpdate.proximo_vencimento = updates.nextDueDate;
    const dia = Number(updates.nextDueDate.split("-")[2]);
    if (dia >= 1 && dia <= 28) dbUpdate.dia_vencimento = dia;
  }

  await supabase.from("assinaturas").update(dbUpdate).eq("id", assinaturaId);

  const cobrancaLocalUpdate: Record<string, unknown> = { updated_at: now };
  if (updates.valor != null && updates.valor > 0) {
    cobrancaLocalUpdate.valor = updates.valor;
  }
  if (updates.nextDueDate) {
    cobrancaLocalUpdate.vencimento = updates.nextDueDate;
  }
  if (Object.keys(cobrancaLocalUpdate).length > 1) {
    await supabase
      .from("cobrancas")
      .update(cobrancaLocalUpdate)
      .eq("assinatura_id", assinaturaId)
      .in("status", ["PENDING", "OVERDUE"]);
  }

  let updatedCurrentPayment = false;
  const asaasConfig = await getAsaasConfig(supabase);
  const canSyncAsaas =
    asaasConfig?.api_key &&
    assinatura.asaas_subscription_id &&
    assinatura.status === "ACTIVE";

  if (canSyncAsaas) {
    try {
      const asaas = new AsaasClient(asaasConfig);
      const payload: { value?: number; nextDueDate?: string; description?: string } = {};
      if (updates.valor != null && updates.valor > 0) payload.value = updates.valor;
      if (updates.nextDueDate) payload.nextDueDate = updates.nextDueDate;
      if (updates.descricao?.trim()) payload.description = updates.descricao.trim();

      if (Object.keys(payload).length > 0) {
        await asaas.updateSubscription(assinatura.asaas_subscription_id, payload);
      }

      const abertas = await asaas.listPaymentsBySubscription(
        assinatura.asaas_subscription_id,
        "ALL"
      );
      const pendentes = (abertas.data ?? []).filter((p) => isEditableOpenPayment(p));

      for (const pay of pendentes) {
        const payPayload: { value?: number; dueDate?: string; description?: string } = {};
        if (updates.valor != null && updates.valor > 0) {
          payPayload.value = updates.valor;
        }
        if (updates.nextDueDate) payPayload.dueDate = updates.nextDueDate;
        if (updates.descricao?.trim()) payPayload.description = updates.descricao.trim();
        if (Object.keys(payPayload).length === 0) continue;

        await asaas.updatePayment(pay.id, payPayload);
        updatedCurrentPayment = true;

        const cobrancaUpdate: Record<string, unknown> = { updated_at: now };
        if (payPayload.value != null) cobrancaUpdate.valor = payPayload.value;
        if (payPayload.dueDate) cobrancaUpdate.vencimento = payPayload.dueDate;

        await supabase
          .from("cobrancas")
          .update(cobrancaUpdate)
          .eq("asaas_payment_id", pay.id);
      }
    } catch {
      // Dados locais já salvos; Asaas pode ser reconciliado depois.
    }
  }

  await createLog(supabase, {
    usuario_id: userId,
    acao: "assinatura_atualizada",
    entidade: "assinaturas",
    entidade_id: assinaturaId,
    payload: updates,
  });

  return { updatedCurrentPayment };
}

export async function reactivateSubscription(
  supabase: SupabaseClient,
  assinaturaId: string,
  userId?: string
) {
  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select("*")
    .eq("id", assinaturaId)
    .single();

  if (!assinatura) throw new Error("Assinatura não encontrada");

  if (await hasActiveSubscription(supabase, assinatura.beneficiario_id)) {
    throw new Error("Este cliente já possui assinatura ativa.");
  }

  const asaasConfig = await getAsaasConfig(supabase);
  if (asaasConfig?.api_key) {
    const asaas = new AsaasClient(asaasConfig);
    await asaas.updateSubscription(assinatura.asaas_subscription_id, {
      status: "ACTIVE",
    });
  }

  await supabase
    .from("assinaturas")
    .update({ status: "ACTIVE", updated_at: new Date().toISOString() })
    .eq("id", assinaturaId);

  await createLog(supabase, {
    usuario_id: userId,
    acao: "assinatura_reativada",
    entidade: "assinaturas",
    entidade_id: assinaturaId,
  });
}
