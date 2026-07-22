import type { SupabaseClient } from "@supabase/supabase-js";
import { createLog } from "@/lib/logger";
import {
  cancelBridgeJobsForBeneficiario,
  cascadeInactivateDependentsOfTitular,
} from "@/lib/services/bridge-jobs";
import { cancelActiveSubscriptionsForBeneficiario } from "@/lib/services/subscriptions";
import { enqueueInfinityJob } from "@/lib/services/infinity-jobs";

/**
 * Desvínculo manual (sem extensão):
 * - marca inativo no Manager
 * - cancela jobs de ponte pendentes dessa pessoa
 * - cancela assinatura/cobranças no Asaas (ou enfileira cancel Infinity)
 * - inativa dependentes do titular (+ fila HR)
 *
 * Não altera o HR TotalPass do titular — o operador confirma que já fez (ou fará) lá.
 * Seguro com vários provedores: age só no beneficiario_id informado.
 */
export async function desvincularBeneficiarioManual(
  supabase: SupabaseClient,
  beneficiarioId: string,
  options: {
    userId?: string;
    notificar?: boolean;
    confirmouHr?: boolean;
  } = {}
) {
  if (!options.confirmouHr) {
    throw new Error(
      "Confirme que o beneficiário já foi tratado no TotalPass HR (inativado/removido) ou que fará isso manualmente."
    );
  }

  const { data: beneficiario, error } = await supabase
    .from("beneficiarios")
    .select(
      "id, nome, perfil, status_totalpass, cpf, provedor_id, gateway_pagamento, infinity_customer_id"
    )
    .eq("id", beneficiarioId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!beneficiario) throw new Error("Beneficiário não encontrado");
  if (beneficiario.perfil !== "titular") {
    throw new Error(
      "Desvínculo manual completo é para titulares. Dependentes: edite o status ou ajuste a cobrança no titular."
    );
  }

  const jobsCancelados = await cancelBridgeJobsForBeneficiario(
    supabase,
    beneficiarioId,
    "desvinculo_manual"
  );

  const agora = new Date().toISOString();
  const { error: updError } = await supabase
    .from("beneficiarios")
    .update({
      status_totalpass: "inativo",
      observacoes: "Desvinculado manualmente (sem automação da extensão)",
      updated_at: agora,
    })
    .eq("id", beneficiarioId);

  if (updError) throw new Error(updError.message);

  const cascade = await cascadeInactivateDependentsOfTitular(supabase, {
    titularId: beneficiarioId,
    parentJobId: `manual:${beneficiarioId}:${agora.slice(0, 10)}`,
    userId: options.userId,
  });

  let cancelResult: { cancelled: number } = { cancelled: 0 };
  if (beneficiario.gateway_pagamento === "infinity") {
    try {
      await enqueueInfinityJob(supabase, {
        tipo: "cancel_subscription",
        beneficiarioId,
        userId: options.userId,
        idempotencyKey: `cancel_subscription:desvinculo_manual:${beneficiarioId}:${agora.slice(0, 10)}`,
        payload: {
          reason: "desvinculo_manual",
          infinity_customer_id: beneficiario.infinity_customer_id,
        },
      });
    } catch {
      // Sem slug / teto — operador pode cancelar na Infinity manualmente.
    }
  } else {
    cancelResult = await cancelActiveSubscriptionsForBeneficiario(
      supabase,
      beneficiarioId,
      {
        notificar: options.notificar ?? false,
        userId: options.userId,
        motivo: "desvinculo_manual",
      }
    );
  }

  await createLog(supabase, {
    usuario_id: options.userId,
    acao: "desvinculo_manual",
    entidade: "beneficiarios",
    entidade_id: beneficiarioId,
    payload: {
      cpf_tail: String(beneficiario.cpf || "").replace(/\D/g, "").slice(-4),
      provedor_id: beneficiario.provedor_id,
      jobs_cancelados: jobsCancelados,
      dependentes_marcados: cascade.marked,
      dependentes_enfileirados: cascade.enqueued,
      assinaturas_canceladas: cancelResult.cancelled,
      notificar: options.notificar ?? false,
    },
  });

  return {
    ok: true,
    beneficiarioId,
    jobsCancelados,
    assinaturasCanceladas: cancelResult.cancelled,
    cascade,
  };
}
