import type { SupabaseClient } from "@supabase/supabase-js";
import { createLog } from "@/lib/logger";
import { getInfinityConfigRaw } from "@/lib/config";
import {
  getBrazilDateString,
  getBrazilDayStartUtcIso,
} from "@/lib/services/reminder-schedule";
import {
  cancelBridgeJobsForBeneficiario,
  getBridgeConfig,
  getBridgeHealthStatus,
  isBeneficiarioDesvinculoConcluido,
  reclaimStaleBridgeJobs,
} from "@/lib/services/bridge-jobs";
import {
  coerceInfinityInvoiceStatus,
  deriveInfinityCustomerStatusFromInvoices,
} from "@/lib/infinity-payment-status";
import {
  enqueueInfinityAvisoValidacao,
  maybeAlertPendingValidacoesWhenOffline,
  processConfirmedInfinityValidacoes,
} from "@/lib/services/infinity-aviso-validacao";

/**
 * Fase 4 — inadimplência InfinitePay (seguro, sem webhook):
 * 1) Enfileira validação → extensão consulta só esses IDs
 * 2) Só após confirmed_overdue → aviso WhatsApp / desvínculo
 * Se extensão offline: alerta admin, não avisa cliente, fica pendente.
 * Só roda se infinity.automacao_desvinculo_ativa === true.
 */
export async function processInfinityOverdueInactivations(
  supabase: SupabaseClient
) {
  const infinity = await getInfinityConfigRaw(supabase);
  const bridge = await getBridgeConfig(supabase);
  const dryRun = infinity.dry_run === true;

  if (!infinity.automacao_desvinculo_ativa) {
    return {
      gateway: "infinity" as const,
      dryRun,
      scanned: 0,
      avisados: 0,
      enfileirados: 0,
      aguardandoManual: 0,
      skipped: 0,
      validacoesEnfileiradas: 0,
      errors: [] as string[],
      paused: true,
      reason: "automacao_desvinculo_infinity_desligada",
    };
  }

  if (!infinity.ativa) {
    return {
      gateway: "infinity" as const,
      dryRun,
      scanned: 0,
      avisados: 0,
      enfileirados: 0,
      aguardandoManual: 0,
      skipped: 0,
      validacoesEnfileiradas: 0,
      errors: [] as string[],
      paused: true,
      reason: "integracao_infinity_desligada",
    };
  }

  // Processa o que a extensão já confirmou (aviso / desvínculo)
  const confirmed = await processConfirmedInfinityValidacoes(supabase);

  const health = await getBridgeHealthStatus(supabase, bridge);
  const bridgeOnline = health.online;

  if (bridgeOnline) {
    await reclaimStaleBridgeJobs(
      supabase,
      Math.max(25, bridge.heartbeat_ttl_minutos * 2)
    );
  }

  const today = getBrazilDateString(new Date());
  const dayStartIso = getBrazilDayStartUtcIso(new Date());
  const carenciaCutoff = (() => {
    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - bridge.dias_carencia);
    return dt.toISOString().slice(0, 10);
  })();

  const { count: succeededToday } = await supabase
    .from("bridge_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "succeeded")
    .eq("motivo", "inadimplencia_infinity")
    .gte("completed_at", dayStartIso);

  let remainingDailyCap = Math.max(
    0,
    Math.min(
      bridge.teto_diario_inativacoes,
      infinity.teto_diario_operacoes
    ) - (succeededToday ?? 0)
  );

  const { count: pendingToday } = await supabase
    .from("bridge_jobs")
    .select("id", { count: "exact", head: true })
    .eq("motivo", "inadimplencia_infinity")
    .in("status", ["pending", "claimed", "running"])
    .gte("created_at", dayStartIso);

  remainingDailyCap = Math.max(0, remainingDailyCap - (pendingToday ?? 0));

  const { data: overdueRows, error } = await supabase
    .from("infinity_customer_status")
    .select(
      "infinity_customer_id, infinity_subscription_slug, beneficiario_id, nome, payment_status, amount, due_date, invoice_slug, invoice_description, beneficiario:beneficiarios!inner(id, nome, cpf, telefone, perfil, status_totalpass, gateway_pagamento)"
    )
    .eq("payment_status", "overdue")
    .not("beneficiario_id", "is", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const candidates = (overdueRows ?? []).filter((row) => {
    const due = row.due_date ? String(row.due_date).slice(0, 10) : null;
    if (!due) return true;
    return due <= carenciaCutoff;
  });

  const summary = {
    gateway: "infinity" as const,
    dryRun,
    scanned: candidates.length,
    avisados: confirmed.avisosEnviados,
    enfileirados: confirmed.desvinculosEnfileirados,
    aguardandoManual: 0,
    skipped: confirmed.skipped,
    validacoesEnfileiradas: 0,
    limposPagos: confirmed.limposPagos,
    errors: [...confirmed.errors] as string[],
    bridgeOnline,
    bridgeHealthReason: health.reason,
  };

  for (const row of candidates) {
    const ben = row.beneficiario as unknown as {
      id: string;
      nome: string;
      cpf: string;
      telefone: string | null;
      perfil: string;
      status_totalpass: string;
      gateway_pagamento?: string | null;
    };

    if (!ben || ben.perfil !== "titular") {
      summary.skipped++;
      continue;
    }

    if (ben.gateway_pagamento && ben.gateway_pagamento !== "infinity") {
      summary.skipped++;
      continue;
    }

    if (["inativo", "cancelado"].includes(ben.status_totalpass)) {
      summary.skipped++;
      continue;
    }

    // Clientes Infinity NÃO dependem de assinatura Asaas ACTIVE.
    // (O fluxo Asaas em overdue-inactivation.ts continua exigindo.)

    const customerId = String(row.infinity_customer_id);

    const { data: invRows } = await supabase
      .from("infinity_invoices")
      .select("status, paid_at")
      .eq("infinity_customer_id", customerId);
    if (invRows && invRows.length > 0) {
      const derived = deriveInfinityCustomerStatusFromInvoices(
        invRows.map((i) => ({
          status: coerceInfinityInvoiceStatus(i.status, i.paid_at),
          paid_at: i.paid_at,
        }))
      );
      if (derived && derived !== "overdue") {
        if (derived === "paid") {
          await supabase
            .from("infinity_customer_status")
            .update({
              payment_status: "paid",
              updated_at: new Date().toISOString(),
            })
            .eq("infinity_customer_id", customerId);
        }
        summary.skipped++;
        continue;
      }
    }

    try {
      const { data: aviso } = await supabase
        .from("infinity_desvinculo_avisos")
        .select("*")
        .eq("beneficiario_id", ben.id)
        .eq("infinity_customer_id", customerId)
        .maybeSingle();

      if (!aviso) {
        if (dryRun) {
          await createLog(supabase, {
            acao: "infinity_dry_run_enqueue_validacao_aviso",
            entidade: "infinity_customer_status",
            entidade_id: customerId,
            payload: { beneficiario_id: ben.id },
          });
          summary.validacoesEnfileiradas++;
          continue;
        }

        const enq = await enqueueInfinityAvisoValidacao(supabase, {
          infinityCustomerId: customerId,
          beneficiarioId: ben.id,
          fase: "aviso",
        });
        if (enq.created) summary.validacoesEnfileiradas++;
        else summary.skipped++;
        continue;
      }

      if (aviso.data_limite > today) {
        summary.skipped++;
        continue;
      }

      if (remainingDailyCap <= 0) {
        summary.aguardandoManual++;
        continue;
      }

      if (await isBeneficiarioDesvinculoConcluido(supabase, ben.id)) {
        await cancelBridgeJobsForBeneficiario(
          supabase,
          ben.id,
          "ja_desvinculado"
        );
        summary.skipped++;
        continue;
      }

      if (dryRun) {
        await createLog(supabase, {
          acao: "infinity_dry_run_enqueue_validacao_desvinculo",
          entidade: "infinity_customer_status",
          entidade_id: customerId,
        });
        summary.validacoesEnfileiradas++;
        remainingDailyCap--;
        continue;
      }

      const enq = await enqueueInfinityAvisoValidacao(supabase, {
        infinityCustomerId: customerId,
        beneficiarioId: ben.id,
        fase: "desvinculo",
      });
      if (enq.created) {
        summary.validacoesEnfileiradas++;
        remainingDailyCap--;
      } else {
        summary.skipped++;
      }
    } catch (e) {
      summary.errors.push(
        `${customerId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const offlineAlert = await maybeAlertPendingValidacoesWhenOffline(supabase);

  return {
    ...summary,
    offlineAlert,
  };
}
