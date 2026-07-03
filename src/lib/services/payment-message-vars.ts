import type { SupabaseClient } from "@supabase/supabase-js";
import { AsaasClient } from "@/lib/asaas/client";
import { getAsaasConfig } from "@/lib/config";

export interface PaymentWebhookFields {
  invoiceUrl?: string;
  bankSlipUrl?: string;
  identificationField?: string;
}

export async function buildPaymentTemplateVars(
  supabase: SupabaseClient,
  paymentId: string,
  base: {
    nome: string;
    valor: string;
    data_vencimento: string;
  },
  fromWebhook?: PaymentWebhookFields
) {
  let link_fatura = fromWebhook?.invoiceUrl ?? fromWebhook?.bankSlipUrl ?? "";
  let linha_digitavel = fromWebhook?.identificationField ?? "";
  let codigo_pix = "";

  const asaasConfig = await getAsaasConfig(supabase);
  if (asaasConfig?.api_key) {
    const asaas = new AsaasClient(asaasConfig);
    try {
      if (!link_fatura || !linha_digitavel) {
        const details = await asaas.getPaymentDetails(paymentId);
        link_fatura = link_fatura || details.invoiceUrl || details.bankSlipUrl || "";
        linha_digitavel = linha_digitavel || details.identificationField || "";
      }
    } catch {
      // Mantém dados do webhook quando a consulta falhar.
    }

    if (!linha_digitavel) {
      try {
        const boleto = await asaas.getPaymentIdentificationField(paymentId);
        linha_digitavel = boleto.identificationField ?? "";
      } catch {
        // Cobrança pode não ter boleto habilitado.
      }
    }

    try {
      const pix = await asaas.getPaymentPixQrCode(paymentId);
      codigo_pix = pix.payload ?? "";
    } catch {
      // Cobrança pode ser boleto, não PIX.
    }
  }

  return {
    ...base,
    link_fatura,
    codigo_pix,
    linha_digitavel,
  };
}
