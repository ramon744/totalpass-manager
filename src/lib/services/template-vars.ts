import type { SupabaseClient } from "@supabase/supabase-js";
import { AsaasClient } from "@/lib/asaas/client";
import { getAsaasConfig } from "@/lib/config";
import { getVariablesForEvent, TEMPLATE_SAMPLE_VARS } from "@/lib/message-templates";
import { formatDependentesCobranca, formatMoneyValue } from "@/lib/dependent-billing";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import { resolveBeneficioFornecido } from "@/lib/services/provedor-vars";
import type { DependenteCobrancaSnapshot } from "@/types/database";

export async function buildTemplateVarsForBeneficiario(
  supabase: SupabaseClient,
  beneficiarioId: string,
  evento: string
) {
  const { data: beneficiario, error } = await supabase
    .from("beneficiarios")
    .select("id, nome, telefone, asaas_customer_id")
    .eq("id", beneficiarioId)
    .single();

  if (error || !beneficiario) {
    throw new Error("Cliente não encontrado");
  }

  const vars: Record<string, string> = {
    nome: beneficiario.nome,
    beneficio_fornecido: await resolveBeneficioFornecido(supabase, beneficiarioId),
    valor: "",
    vencimento: "",
    data_vencimento: "",
    link_fatura: "",
    codigo_pix: "",
    linha_digitavel: "",
    dependentes: "",
    valor_dependente: "",
    valor_dependentes: "",
    valor_total: "",
    vigencia: "",
    motivo: "",
  };

  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select(
      "valor, dia_vencimento, valor_titular, valor_dependentes, dependentes_cobrados"
    )
    .eq("beneficiario_id", beneficiarioId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (assinatura) {
    vars.valor = Number(assinatura.valor).toFixed(2).replace(".", ",");
    vars.vencimento = String(assinatura.dia_vencimento);
    vars.valor_total = formatMoneyValue(Number(assinatura.valor));
    vars.valor_dependentes = formatMoneyValue(Number(assinatura.valor_dependentes ?? 0));

    const dependentesCobrados = (assinatura.dependentes_cobrados ??
      []) as DependenteCobrancaSnapshot[];
    if (dependentesCobrados.length) {
      vars.dependentes = formatDependentesCobranca(dependentesCobrados);
      vars.valor_dependente = formatMoneyValue(dependentesCobrados[0].valor);
    }
  }

  if (evento.startsWith("dependente_cobranca_")) {
    vars.dependentes ||= TEMPLATE_SAMPLE_VARS.dependentes;
    vars.valor_dependente ||= TEMPLATE_SAMPLE_VARS.valor_dependente;
    vars.valor_dependentes ||= TEMPLATE_SAMPLE_VARS.valor_dependentes;
    vars.valor_total ||= TEMPLATE_SAMPLE_VARS.valor_total;
    vars.vigencia ||= TEMPLATE_SAMPLE_VARS.vigencia;
    vars.motivo ||= TEMPLATE_SAMPLE_VARS.motivo;
  }

  const needsPaymentVars = getVariablesForEvent(evento).includes("link_fatura");

  if (needsPaymentVars) {
    let paymentId: string | null = null;

    const { data: cobranca } = await supabase
      .from("cobrancas")
      .select("asaas_payment_id, valor, vencimento")
      .eq("beneficiario_id", beneficiarioId)
      .in("status", ["PENDING", "OVERDUE"])
      .order("vencimento", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cobranca?.asaas_payment_id) {
      paymentId = cobranca.asaas_payment_id;
      vars.valor = Number(cobranca.valor).toFixed(2).replace(".", ",");
      vars.data_vencimento = cobranca.vencimento.split("-").reverse().join("/");
    } else if (beneficiario.asaas_customer_id) {
      const asaasConfig = await getAsaasConfig(supabase);
      if (asaasConfig?.api_key) {
        const asaas = new AsaasClient(asaasConfig);
        try {
          const pending = await asaas.listPaymentsByCustomer(
            beneficiario.asaas_customer_id,
            "PENDING"
          );
          const payment = pending.data?.[0];
          if (payment) {
            paymentId = payment.id;
            vars.valor = Number(payment.value).toFixed(2).replace(".", ",");
            vars.data_vencimento = payment.dueDate.split("-").reverse().join("/");
          }
        } catch {
          // Sem cobrança pendente no Asaas.
        }
      }
    }

    if (!vars.data_vencimento && assinatura) {
      const today = new Date();
      const dia = assinatura.dia_vencimento;
      let due = new Date(today.getFullYear(), today.getMonth(), dia);
      if (due <= today) {
        due = new Date(today.getFullYear(), today.getMonth() + 1, dia);
      }
      vars.data_vencimento = due.toISOString().split("T")[0].split("-").reverse().join("/");
    }

    if (paymentId) {
      const paymentVars = await buildPaymentTemplateVars(supabase, paymentId, {
        nome: beneficiario.nome,
        valor: vars.valor || "0,00",
        data_vencimento: vars.data_vencimento || "",
      });
      Object.assign(vars, paymentVars);
    }
  }

  return {
    vars,
    telefone: beneficiario.telefone,
    temAssinatura: !!assinatura,
    temCobrancaPendente: !!(vars.link_fatura || vars.codigo_pix || vars.linha_digitavel),
  };
}
