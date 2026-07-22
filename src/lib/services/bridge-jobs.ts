import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import {
  alertAdminBridgeJobFailed,
  alertAdminTotalPassIntegrationBroken,
  looksLikeTotalPassApiBreak,
  notifyAdminAlert,
} from "@/lib/services/admin-alerts";
import { cancelActiveSubscriptionsForBeneficiario } from "@/lib/services/subscriptions";
import { enqueueInfinityJob } from "@/lib/services/infinity-jobs";
import { getBrazilDayStartUtcIso } from "@/lib/services/reminder-schedule";
import { renderTemplate } from "@/lib/uazapi/client";
import type { BridgeJob, ConfigBridge } from "@/types/database";
import { DEFAULT_BRIDGE_CONFIG } from "@/types/database";

export async function getBridgeConfig(
  supabase: SupabaseClient
): Promise<Required<ConfigBridge>> {
  const raw = await getConfig<ConfigBridge>(supabase, "bridge");
  return {
    ...DEFAULT_BRIDGE_CONFIG,
    ...raw,
    admin_telefone: raw?.admin_telefone?.trim() || "",
    admin_email: raw?.admin_email?.trim() || "",
    automacao_inativacao_ativa:
      raw?.automacao_inativacao_ativa !== false,
  };
}

export type BridgeHealthStatus = {
  online: boolean;
  reason: string;
  lastSeenAt: string | null;
  sessionOk: boolean | null;
  installationId: string | null;
  lastError: string | null;
  extensionVersion: string | null;
  lastOfflineAlertAt: string | null;
};

/**
 * Saúde da extensão/ponte:
 * online se QUALQUER instância tiver heartbeat recente + sessão HR ok
 * (+ last_health_ok !== false).
 */
export async function getBridgeHealthStatus(
  supabase: SupabaseClient,
  bridge?: Required<ConfigBridge>
): Promise<BridgeHealthStatus> {
  const cfg = bridge ?? (await getBridgeConfig(supabase));
  const ttlMs = cfg.heartbeat_ttl_minutos * 60_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  const { data: instances } = await supabase
    .from("bridge_instances")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(20);

  if (!instances?.length) {
    return {
      online: false,
      reason: "nenhuma_extensao",
      lastSeenAt: null,
      sessionOk: null,
      installationId: null,
      lastError: null,
      extensionVersion: null,
      lastOfflineAlertAt: null,
    };
  }

  const isHealthy = (inst: (typeof instances)[number]) =>
    Boolean(inst.session_ok) &&
    inst.last_seen_at >= cutoff &&
    inst.last_health_ok !== false;

  const healthy = instances.find(isHealthy);
  const latest = instances[0];
  const lastOfflineAlertAt =
    instances
      .map((i) => i.last_offline_alert_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  if (healthy) {
    return {
      online: true,
      reason: "ok",
      lastSeenAt: healthy.last_seen_at,
      sessionOk: true,
      installationId: healthy.installation_id,
      lastError: healthy.last_error ?? null,
      extensionVersion: healthy.extension_version ?? null,
      lastOfflineAlertAt,
    };
  }

  // Nenhuma saudável: reporta o motivo da mais recente
  let reason = "sessao_hr_invalida";
  if (!latest.session_ok) reason = "sessao_hr_invalida";
  else if (latest.last_seen_at < cutoff) reason = "heartbeat_expirado";
  else if (latest.last_health_ok === false) reason = "saude_extensao_ruim";

  return {
    online: false,
    reason,
    lastSeenAt: latest.last_seen_at,
    sessionOk: Boolean(latest.session_ok),
    installationId: latest.installation_id,
    lastError: latest.last_error ?? null,
    extensionVersion: latest.extension_version ?? null,
    lastOfflineAlertAt,
  };
}

/**
 * Devolve à fila jobs claimed/running abandonados (extensão caiu no meio).
 * Não incrementa attempts de novo — o claim original já contou.
 */
export async function reclaimStaleBridgeJobs(
  supabase: SupabaseClient,
  staleMinutes = 25
): Promise<number> {
  const minutes = Math.max(5, Math.min(180, staleMinutes));
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("bridge_jobs")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      last_error: "reclaim_stale",
      run_after: now,
      updated_at: now,
    })
    .in("status", ["claimed", "running"])
    .lt("updated_at", cutoff)
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Desvínculo já concluído no Manager: inativo e sem assinatura ACTIVE.
 * (manual ou automação anterior — não deve enfileirar/processar de novo)
 */
export async function isBeneficiarioDesvinculoConcluido(
  supabase: SupabaseClient,
  beneficiarioId: string
): Promise<boolean> {
  const { data: ben } = await supabase
    .from("beneficiarios")
    .select("id, status_totalpass")
    .eq("id", beneficiarioId)
    .maybeSingle();

  if (!ben || ben.status_totalpass !== "inativo") return false;

  const { data: assinatura } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("beneficiario_id", beneficiarioId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  return !assinatura;
}

/**
 * Cancela jobs abertos de quem já foi desvinculado no Manager.
 * Chamado antes do claim para a extensão não reprocessar.
 */
export async function cancelObsoleteInactivationJobs(
  supabase: SupabaseClient
): Promise<number> {
  const { data: jobs, error } = await supabase
    .from("bridge_jobs")
    .select("id, beneficiario_id")
    .eq("tipo", "inactivate_totalpass")
    .in("status", ["pending", "claimed", "running"])
    .limit(100);

  if (error) throw new Error(error.message);
  if (!jobs?.length) return 0;

  let cancelled = 0;
  const seen = new Set<string>();

  for (const job of jobs) {
    if (seen.has(job.beneficiario_id)) continue;
    seen.add(job.beneficiario_id);

    if (await isBeneficiarioDesvinculoConcluido(supabase, job.beneficiario_id)) {
      cancelled += await cancelBridgeJobsForBeneficiario(
        supabase,
        job.beneficiario_id,
        "ja_desvinculado"
      );
    }
  }

  return cancelled;
}

export function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export async function countPendingBridgeJobs(supabase: SupabaseClient) {
  const { count } = await supabase
    .from("bridge_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "claimed", "running"]);
  return count ?? 0;
}

export async function upsertBridgeHeartbeat(
  supabase: SupabaseClient,
  params: {
    installationId: string;
    extensionVersion?: string | null;
    sessionOk: boolean;
    sessionEmail?: string | null;
    lastError?: string | null;
    healthOk?: boolean | null;
  }
) {
  const pendingCount = await countPendingBridgeJobs(supabase);
  const now = new Date().toISOString();
  const lastError = params.lastError
    ? String(params.lastError).slice(0, 500)
    : null;
  const healthOk =
    params.healthOk == null ? params.sessionOk && !lastError : Boolean(params.healthOk);

  const { data, error } = await supabase
    .from("bridge_instances")
    .upsert(
      {
        installation_id: params.installationId,
        extension_version: params.extensionVersion ?? null,
        last_seen_at: now,
        session_ok: params.sessionOk,
        session_email: params.sessionEmail ?? null,
        pending_jobs_count: pendingCount,
        last_error: lastError,
        last_health_ok: healthOk,
      },
      { onConflict: "installation_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // Integração quebrada / sessão inválida com erro estrutural → avisa admin
  if (lastError && (!healthOk || !params.sessionOk)) {
    if (looksLikeTotalPassApiBreak(lastError) || !params.sessionOk) {
      alertAdminTotalPassIntegrationBroken(supabase, {
        installationId: params.installationId,
        error: lastError,
        sessionOk: params.sessionOk,
      }).catch(() => {});
    }
  }

  return { instance: data, pendingCount, serverTime: now };
}

export async function claimBridgeJobs(
  supabase: SupabaseClient,
  installationId: string,
  limit = 3
): Promise<BridgeJob[]> {
  const { data, error } = await supabase.rpc("claim_bridge_jobs", {
    p_installation_id: installationId,
    p_limit: limit,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as BridgeJob[];
}

export async function enqueueBridgeJob(
  supabase: SupabaseClient,
  params: {
    beneficiarioId: string;
    cpf: string;
    cobrancaId?: string | null;
    infinityCustomerId?: string | null;
    dataLimite: string;
    motivo?: string;
  }
) {
  const ref =
    (params.cobrancaId && String(params.cobrancaId).trim()) ||
    (params.infinityCustomerId
      ? `infinity:${String(params.infinityCustomerId).trim()}`
      : "");
  if (!ref) {
    throw new Error("Informe cobrancaId ou infinityCustomerId para o job");
  }

  const idempotencyKey = `inactivate:${params.beneficiarioId}:${ref}`;
  const payload = {
    reason_explanation: "Employee dismissal",
    data_limite: params.dataLimite,
    cobranca_id: params.cobrancaId ?? null,
    infinity_customer_id: params.infinityCustomerId ?? null,
    gateway: params.infinityCustomerId ? "infinity" : "asaas",
  };

  const { data: existing } = await supabase
    .from("bridge_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    if (["pending", "claimed", "running", "succeeded"].includes(existing.status)) {
      return { created: false, jobId: existing.id as string, status: existing.status };
    }
    // failed/cancelled → reabre
    const { data: updated, error } = await supabase
      .from("bridge_jobs")
      .update({
        status: "pending",
        attempts: 0,
        last_error: null,
        claimed_at: null,
        claimed_by: null,
        run_after: new Date().toISOString(),
        completed_at: null,
        result: null,
        payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, status")
      .single();

    if (error) throw new Error(error.message);
    return { created: true, jobId: updated.id as string, status: updated.status };
  }

  const { data, error } = await supabase
    .from("bridge_jobs")
    .insert({
      tipo: "inactivate_totalpass",
      status: "pending",
      beneficiario_id: params.beneficiarioId,
      cpf: digitsOnly(params.cpf),
      motivo: params.motivo ?? "inadimplencia",
      payload,
      idempotency_key: idempotencyKey,
    })
    .select("id, status")
    .single();

  if (error) throw new Error(error.message);
  return { created: true, jobId: data.id as string, status: data.status };
}

export async function cancelBridgeJobsForCobranca(
  supabase: SupabaseClient,
  cobrancaId: string
) {
  const { data, error } = await supabase
    .from("bridge_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      last_error: "pagamento_confirmado",
      updated_at: new Date().toISOString(),
    })
    .in("status", ["pending", "claimed", "running"])
    .eq("payload->>cobranca_id", cobrancaId)
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function cancelBridgeJobsForBeneficiario(
  supabase: SupabaseClient,
  beneficiarioId: string,
  reason = "pagamento_confirmado"
) {
  const { data, error } = await supabase
    .from("bridge_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("beneficiario_id", beneficiarioId)
    .in("status", ["pending", "claimed", "running"])
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

function backoffMinutes(attempt: number) {
  // 5, 15, 45, 90, 180
  const map = [5, 15, 45, 90, 180];
  return map[Math.min(attempt - 1, map.length - 1)] ?? 180;
}

export async function reportBridgeJobResult(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    installationId: string;
    status: "succeeded" | "failed";
    result?: Record<string, unknown> | null;
    error?: string | null;
    userId?: string | null;
  }
) {
  const { data: job, error: jobError } = await supabase
    .from("bridge_jobs")
    .select("*")
    .eq("id", params.jobId)
    .maybeSingle();

  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job não encontrado");

  if (job.status === "succeeded" || job.status === "cancelled") {
    return { job, alreadyFinal: true };
  }

  if (params.status === "failed") {
    const attempts = job.attempts ?? 1;
    const exhausted = attempts >= (job.max_attempts ?? 5);
    const runAfter = new Date(
      Date.now() + backoffMinutes(attempts) * 60_000
    ).toISOString();

    const { data: updated, error } = await supabase
      .from("bridge_jobs")
      .update({
        status: exhausted ? "failed" : "pending",
        last_error: String(params.error || "falha").slice(0, 500),
        claimed_at: null,
        claimed_by: null,
        run_after: exhausted ? job.run_after : runAfter,
        completed_at: exhausted ? new Date().toISOString() : null,
        result: params.result ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.jobId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    if (exhausted) {
      alertAdminBridgeJobFailed(supabase, {
        jobId: params.jobId,
        cpfTail: digitsOnly(job.cpf).slice(-4),
        error: String(params.error || "falha"),
        attempts,
      }).catch(() => {});
    }

    return { job: updated as BridgeJob, alreadyFinal: false };
  }

  // succeeded
  const { data: updated, error } = await supabase
    .from("bridge_jobs")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      last_error: null,
      result: params.result ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.jobId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await onInactivateSucceeded(supabase, updated as BridgeJob, params.userId);
  return { job: updated as BridgeJob, alreadyFinal: false };
}

/**
 * Inativa no Manager todos os dependentes do titular e enfileira jobs HR
 * para cada CPF (mesmo fluxo do desvínculo Asaas/Infinity).
 */
export async function cascadeInactivateDependentsOfTitular(
  supabase: SupabaseClient,
  params: {
    titularId: string;
    parentJobId: string;
    motivoTitular?: string | null;
    userId?: string | null;
  }
) {
  const { data: deps, error } = await supabase
    .from("beneficiarios")
    .select("id, cpf, nome, status_totalpass")
    .eq("titular_id", params.titularId)
    .eq("perfil", "dependente")
    .neq("status_totalpass", "inativo");

  if (error) throw new Error(error.message);
  if (!deps?.length) {
    return { marked: 0, enqueued: 0 };
  }

  const now = new Date().toISOString();
  const ids = deps.map((d) => d.id);
  const { error: updErr } = await supabase
    .from("beneficiarios")
    .update({
      status_totalpass: "inativo",
      observacoes:
        "Desvinculado automaticamente com o titular (inadimplência)",
      updated_at: now,
    })
    .in("id", ids);

  if (updErr) throw new Error(updErr.message);

  let enqueued = 0;
  for (const dep of deps) {
    const cpf = digitsOnly(dep.cpf);
    if (cpf.length < 11) continue;

    const idempotencyKey = `inactivate:${dep.id}:cascade:${params.parentJobId}`;
    const { data: existing } = await supabase
      .from("bridge_jobs")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (
      existing &&
      ["pending", "claimed", "running", "succeeded"].includes(existing.status)
    ) {
      continue;
    }

    const payload = {
      reason_explanation: "Employee dismissal",
      cascade_from_titular: params.titularId,
      parent_job_id: params.parentJobId,
      perfil: "dependente",
    };

    if (existing) {
      const { error: reopenErr } = await supabase
        .from("bridge_jobs")
        .update({
          status: "pending",
          attempts: 0,
          last_error: null,
          claimed_at: null,
          claimed_by: null,
          run_after: now,
          completed_at: null,
          result: null,
          payload,
          updated_at: now,
        })
        .eq("id", existing.id);
      if (!reopenErr) enqueued++;
      continue;
    }

    const { error: insErr } = await supabase.from("bridge_jobs").insert({
      tipo: "inactivate_totalpass",
      status: "pending",
      beneficiario_id: dep.id,
      cpf,
      motivo: "inadimplencia_cascade_dependente",
      payload,
      idempotency_key: idempotencyKey,
      attempts: 0,
      max_attempts: 5,
      run_after: now,
    });
    if (!insErr) enqueued++;
  }

  await createLog(supabase, {
    usuario_id: params.userId ?? undefined,
    acao: "bridge_cascade_dependentes_inativados",
    entidade: "beneficiarios",
    entidade_id: params.titularId,
    payload: {
      parent_job_id: params.parentJobId,
      marked: ids.length,
      enqueued,
      dependente_ids: ids,
    },
  });

  return { marked: ids.length, enqueued };
}

/**
 * Após sucesso no TotalPass: marca inativo e cancela cobrança no gateway.
 * - Dependentes do titular também ficam inativos (Manager + fila HR)
 * - Asaas: cancela assinaturas Asaas
 * - Infinity: enfileira cancel_subscription (extensão POST /subscriptions/{slug}/cancel)
 */
export async function onInactivateSucceeded(
  supabase: SupabaseClient,
  job: BridgeJob,
  userId?: string | null
) {
  const bridge = await getBridgeConfig(supabase);
  const removedAt =
    typeof job.result?.removed_at === "string"
      ? job.result.removed_at
      : null;

  await supabase
    .from("beneficiarios")
    .update({
      status_totalpass: "inativo",
      observacoes: removedAt
        ? `Desvinculado TotalPass (removed_at=${removedAt}) — inadimplência`
        : "Desvinculado TotalPass — inadimplência",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.beneficiario_id);

  const payload =
    job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};
  const isCascadeDependent =
    job.motivo === "inadimplencia_cascade_dependente" ||
    Boolean(payload.cascade_from_titular);

  // Job do dependente: só marca inativo (já feito). Sem cancelar fatura do titular.
  if (isCascadeDependent) {
    await createLog(supabase, {
      usuario_id: userId ?? undefined,
      acao: "bridge_inactivate_succeeded",
      entidade: "bridge_jobs",
      entidade_id: job.id,
      payload: {
        beneficiario_id: job.beneficiario_id,
        cpf_tail: digitsOnly(job.cpf).slice(-4),
        removed_at: removedAt,
        tp_employee_id: job.result?.tp_employee_id ?? null,
        cascade_from_titular: payload.cascade_from_titular ?? null,
        perfil: "dependente",
      },
    });
    return;
  }

  // Titular: propaga aos dependentes
  try {
    await cascadeInactivateDependentsOfTitular(supabase, {
      titularId: job.beneficiario_id,
      parentJobId: job.id,
      motivoTitular: job.motivo,
      userId,
    });
  } catch (e) {
    await createLog(supabase, {
      usuario_id: userId ?? undefined,
      acao: "bridge_cascade_dependentes_erro",
      entidade: "bridge_jobs",
      entidade_id: job.id,
      payload: {
        beneficiario_id: job.beneficiario_id,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }

  const isInfinity =
    job.motivo === "inadimplencia_infinity" ||
    payload.gateway === "infinity" ||
    Boolean(payload.infinity_customer_id);

  if (isInfinity) {
    try {
      const jobInf = await enqueueInfinityJob(supabase, {
        tipo: "cancel_subscription",
        beneficiarioId: job.beneficiario_id,
        userId: userId ?? undefined,
        idempotencyKey: `cancel_subscription:after_desvinculo:${job.id}`,
        payload: {
          reason: "after_totalpass_desvinculo",
          bridge_job_id: job.id,
          infinity_customer_id: payload.infinity_customer_id ?? null,
        },
      });
      await createLog(supabase, {
        usuario_id: userId ?? undefined,
        acao: "infinity_cancel_enqueued_apos_desvinculo",
        entidade: "infinity_jobs",
        entidade_id: jobInf.id,
        payload: {
          bridge_job_id: job.id,
          beneficiario_id: job.beneficiario_id,
          dry_run: jobInf.dry_run,
          slug: jobInf.infinity_subscription_slug,
        },
      });
    } catch (e) {
      await createLog(supabase, {
        usuario_id: userId ?? undefined,
        acao: "infinity_cancel_enqueue_erro_apos_desvinculo",
        entidade: "bridge_jobs",
        entidade_id: job.id,
        payload: {
          beneficiario_id: job.beneficiario_id,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  } else {
    await cancelActiveSubscriptionsForBeneficiario(
      supabase,
      job.beneficiario_id,
      {
        notificar: bridge.notificar_cancelamento_asaas,
        userId: userId ?? undefined,
        motivo: "inadimplencia_totalpass",
      }
    );
  }

  await createLog(supabase, {
    usuario_id: userId ?? undefined,
    acao: "bridge_inactivate_succeeded",
    entidade: "bridge_jobs",
    entidade_id: job.id,
    payload: {
      beneficiario_id: job.beneficiario_id,
      cpf_tail: digitsOnly(job.cpf).slice(-4),
      removed_at: removedAt,
      tp_employee_id: job.result?.tp_employee_id ?? null,
      gateway: isInfinity ? "infinity" : "asaas",
    },
  });
}

export async function retryFailedBridgeJobs(
  supabase: SupabaseClient,
  limit = 50
) {
  const { data: failed, error: listError } = await supabase
    .from("bridge_jobs")
    .select("id")
    .eq("status", "failed")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (listError) throw new Error(listError.message);
  if (!failed?.length) return 0;

  const ids = failed.map((j) => j.id);
  const { data, error } = await supabase
    .from("bridge_jobs")
    .update({
      status: "pending",
      attempts: 0,
      last_error: null,
      claimed_at: null,
      claimed_by: null,
      run_after: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function getBridgeStatusSummary(supabase: SupabaseClient) {
  const { listDesvinculosPendentesManuais } = await import(
    "@/lib/services/overdue-inactivation"
  );

  const [
    { data: instances },
    { count: pending },
    { count: failed },
    { count: succeededToday },
    pendentesManuais,
  ] = await Promise.all([
    supabase
      .from("bridge_instances")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(5),
    supabase
      .from("bridge_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "claimed", "running"]),
    supabase
      .from("bridge_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("bridge_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "succeeded")
      .gte("completed_at", getBrazilDayStartUtcIso()),
    listDesvinculosPendentesManuais(supabase, 30).catch(() => []),
  ]);

  return {
    instances: instances ?? [],
    pending: pending ?? 0,
    failed: failed ?? 0,
    succeededToday: succeededToday ?? 0,
    pendentesManuaisCount: pendentesManuais.length,
  };
}

export async function sendBridgeOfflineAdminAlert(
  supabase: SupabaseClient
): Promise<{
  sent: boolean;
  reason?: string;
  channels?: { whatsapp?: boolean; email?: boolean };
}> {
  const bridge = await getBridgeConfig(supabase);
  if (!bridge.admin_telefone && !bridge.admin_email) {
    return {
      sent: false,
      reason: "configure admin_telefone e/ou admin_email",
    };
  }

  const pending = await countPendingBridgeJobs(supabase);
  if (pending <= 0) {
    return { sent: false, reason: "sem jobs pendentes" };
  }

  const health = await getBridgeHealthStatus(supabase, bridge);
  if (health.online) {
    return { sent: false, reason: "bridge online com sessão" };
  }

  const alertIntervalMs = bridge.alerta_offline_intervalo_horas * 60 * 60_000;
  if (
    health.lastOfflineAlertAt &&
    Date.now() - new Date(health.lastOfflineAlertAt).getTime() < alertIntervalMs
  ) {
    return { sent: false, reason: "alerta em throttle" };
  }

  const { data: template } = await supabase
    .from("mensagem_templates")
    .select("*")
    .eq("evento", "bridge_offline_admin")
    .eq("ativo", true)
    .maybeSingle();

  const ultimoHeartbeat = health.lastSeenAt
    ? new Date(health.lastSeenAt).toLocaleString("pt-BR")
    : "nunca";

  const corpo =
    template?.corpo ??
    "Bridge TotalPass offline. Há {{pending_count}} pendente(s). Último: {{ultimo_heartbeat}}";

  const mensagem = renderTemplate(corpo, {
    pending_count: String(pending),
    ultimo_heartbeat: ultimoHeartbeat,
  });

  const extra = [
    "",
    "Detalhes:",
    `- Motivo: ${health.reason}`,
    `- Sessão HR: ${health.sessionOk ? "ok" : "offline"}`,
    `- Versão extensão: ${health.extensionVersion || "?"}`,
    health.lastError ? `- Último erro: ${health.lastError}` : null,
    "",
    "A automação de desvínculo pausa sozinha enquanto a ponte estiver offline.",
    "Use o desvínculo manual no Manager se precisar agir agora.",
    "Abra o HR TotalPass logado e confira a extensão (ponte 24h).",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await notifyAdminAlert(supabase, {
    throttleKey: "bridge_offline",
    subject: `[TotalPass] Extensão/bridge offline — ${pending} pendente(s)`,
    text: `${mensagem}${extra}`,
    logAction: "bridge_offline_admin_alert",
    logPayload: {
      pending,
      ultimo_heartbeat: ultimoHeartbeat,
      health_reason: health.reason,
    },
  });

  if (result.sent) {
    const now = new Date().toISOString();
    // Marca throttle em todas as instâncias (multi-extensão)
    await supabase
      .from("bridge_instances")
      .update({ last_offline_alert_at: now });
  }

  return {
    sent: result.sent,
    reason: result.reason,
    channels: result.channels,
  };
}
