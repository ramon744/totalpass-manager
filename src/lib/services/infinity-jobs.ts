import type { SupabaseClient } from "@supabase/supabase-js";
import { getInfinityConfigRaw } from "@/lib/config";
import { createLog } from "@/lib/logger";

export type InfinityJobTipo = "create_charge" | "cancel_subscription";
export type InfinityJobStatus =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type InfinityJob = {
  id: string;
  tipo: InfinityJobTipo;
  status: InfinityJobStatus;
  beneficiario_id: string;
  infinity_customer_id: string | null;
  infinity_subscription_slug: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  idempotency_key: string;
  dry_run: boolean;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  run_after: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function startOfUtcDayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Após cancel_subscription real: marca cliente/faturas abertas como cancelled
 * para sumir da aba "Em atraso". Sync futuro sobrescreve se voltar a cobrança.
 */
export async function markInfinityCancelledAfterSubscriptionCancel(
  supabase: SupabaseClient,
  params: {
    infinityCustomerId?: string | null;
    beneficiarioId?: string | null;
    jobId?: string | null;
  }
) {
  let customerId = params.infinityCustomerId
    ? String(params.infinityCustomerId).trim()
    : "";

  if (!customerId && params.beneficiarioId) {
    const { data: st } = await supabase
      .from("infinity_customer_status")
      .select("infinity_customer_id")
      .eq("beneficiario_id", params.beneficiarioId)
      .maybeSingle();
    customerId = st?.infinity_customer_id
      ? String(st.infinity_customer_id)
      : "";
  }

  if (!customerId) return { updatedStatus: false, updatedInvoices: 0 };

  const now = new Date().toISOString();
  const { error: stErr } = await supabase
    .from("infinity_customer_status")
    .update({
      payment_status: "cancelled",
      updated_at: now,
    })
    .eq("infinity_customer_id", customerId)
    .in("payment_status", ["overdue", "pending", "unknown", "inactive"]);

  if (stErr) throw new Error(stErr.message);

  const { data: invRows, error: invErr } = await supabase
    .from("infinity_invoices")
    .update({
      status: "cancelled",
      updated_at: now,
    })
    .eq("infinity_customer_id", customerId)
    .in("status", ["overdue", "pending", "unknown"])
    .select("infinity_invoice_slug");

  if (invErr) throw new Error(invErr.message);

  await createLog(supabase, {
    acao: "infinity_status_cancelled_apos_cancel_subscription",
    entidade: "infinity_customer_status",
    entidade_id: customerId,
    payload: {
      job_id: params.jobId ?? null,
      beneficiario_id: params.beneficiarioId ?? null,
      invoices_cancelled: (invRows ?? []).length,
    },
  });

  return {
    updatedStatus: true,
    updatedInvoices: (invRows ?? []).length,
  };
}

export async function countInfinityJobsToday(
  supabase: SupabaseClient
): Promise<number> {
  const { count } = await supabase
    .from("infinity_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfUtcDayIso())
    .neq("status", "cancelled");
  return count ?? 0;
}

/**
 * Enfileira create_charge ou cancel_subscription para titular gateway=infinity.
 * dry_run vem do config no momento do enqueue (snapshot).
 */
export async function enqueueInfinityJob(
  supabase: SupabaseClient,
  params: {
    tipo: InfinityJobTipo;
    beneficiarioId: string;
    payload?: Record<string, unknown>;
    userId?: string | null;
    idempotencyKey?: string;
  }
) {
  const cfg = await getInfinityConfigRaw(supabase);
  if (!cfg.ativa) {
    throw new Error("Integração Infinity desligada nas Configurações.");
  }

  const used = await countInfinityJobsToday(supabase);
  if (used >= cfg.teto_diario_operacoes) {
    throw new Error(
      `Teto diário de operações Infinity atingido (${cfg.teto_diario_operacoes}).`
    );
  }

  const { data: ben, error: benErr } = await supabase
    .from("beneficiarios")
    .select(
      "id, nome, cpf, perfil, gateway_pagamento, infinity_customer_id, infinity_subscription_slug"
    )
    .eq("id", params.beneficiarioId)
    .maybeSingle();

  if (benErr || !ben) {
    throw new Error(benErr?.message ?? "Beneficiário não encontrado");
  }
  if (ben.perfil !== "titular") {
    throw new Error("Só titulares podem ter jobs Infinity");
  }
  if (ben.gateway_pagamento !== "infinity") {
    throw new Error("Beneficiário não está no gateway Infinity");
  }

  let subscriptionSlug = ben.infinity_subscription_slug
    ? String(ben.infinity_subscription_slug)
    : null;
  let customerId = ben.infinity_customer_id
    ? String(ben.infinity_customer_id)
    : null;

  // Fallback: snapshot Infinity (slug pode estar só em infinity_customer_status)
  if (!subscriptionSlug || !customerId) {
    let statusQ = supabase
      .from("infinity_customer_status")
      .select(
        "infinity_customer_id, infinity_subscription_slug"
      )
      .limit(1);
    if (customerId) {
      statusQ = statusQ.eq("infinity_customer_id", customerId);
    } else {
      statusQ = statusQ.eq("beneficiario_id", params.beneficiarioId);
    }
    const { data: st } = await statusQ.maybeSingle();
    if (st) {
      customerId = customerId || String(st.infinity_customer_id);
      subscriptionSlug =
        subscriptionSlug ||
        (st.infinity_subscription_slug
          ? String(st.infinity_subscription_slug)
          : null);
    }
  }

  if (params.tipo === "cancel_subscription" && !customerId) {
    throw new Error(
      "Cliente Infinity (id) não encontrado para excluir/cancelar. Sincronize e tente de novo."
    );
  }

  const idempotencyKey =
    params.idempotencyKey ||
    `${params.tipo}:${params.beneficiarioId}:${new Date().toISOString().slice(0, 10)}`;

  const { data: existing } = await supabase
    .from("infinity_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    if (["pending", "claimed", "running", "succeeded"].includes(existing.status)) {
      return existing as InfinityJob;
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("infinity_jobs")
    .upsert(
      {
        tipo: params.tipo,
        status: "pending",
        beneficiario_id: ben.id,
        infinity_customer_id: customerId,
        infinity_subscription_slug: subscriptionSlug,
        payload: {
          nome: ben.nome,
          cpf: ben.cpf,
          ...(params.payload ?? {}),
        },
        idempotency_key: idempotencyKey,
        dry_run: cfg.dry_run !== false,
        attempts: 0,
        max_attempts: 5,
        last_error: null,
        claimed_at: null,
        claimed_by: null,
        run_after: now,
        completed_at: null,
        result: null,
        updated_at: now,
      },
      { onConflict: "idempotency_key" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  await createLog(supabase, {
    usuario_id: params.userId ?? undefined,
    acao: "infinity_job_enqueued",
    entidade: "infinity_jobs",
    entidade_id: data.id,
    payload: {
      tipo: params.tipo,
      beneficiario_id: ben.id,
      dry_run: data.dry_run,
    },
  });

  return data as InfinityJob;
}

export async function claimInfinityJobs(
  supabase: SupabaseClient,
  installationId: string,
  limit = 3
) {
  const { data, error } = await supabase.rpc("claim_infinity_jobs", {
    p_installation_id: installationId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as InfinityJob[];
}

export async function reclaimStaleInfinityJobs(
  supabase: SupabaseClient,
  staleMinutes = 25
) {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { error } = await supabase
    .from("infinity_jobs")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
      last_error: "reclaim: extensão não reportou a tempo",
    })
    .in("status", ["claimed", "running"])
    .lt("claimed_at", cutoff);
  if (error) throw new Error(error.message);
}

export async function reportInfinityJobResult(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    installationId: string;
    status: "succeeded" | "failed";
    result?: Record<string, unknown> | null;
    error?: string | null;
  }
) {
  const { data: job, error: findErr } = await supabase
    .from("infinity_jobs")
    .select("*")
    .eq("id", params.jobId)
    .maybeSingle();

  if (findErr || !job) {
    throw new Error(findErr?.message ?? "Job não encontrado");
  }

  if (job.claimed_by && job.claimed_by !== params.installationId) {
    throw new Error("Job reclamado por outra instalação");
  }

  const now = new Date().toISOString();

  if (params.status === "succeeded") {
    const { data, error } = await supabase
      .from("infinity_jobs")
      .update({
        status: "succeeded",
        result: params.result ?? { ok: true },
        last_error: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", params.jobId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await createLog(supabase, {
      acao: "infinity_job_succeeded",
      entidade: "infinity_jobs",
      entidade_id: params.jobId,
      payload: {
        tipo: job.tipo,
        dry_run: job.dry_run,
        result: params.result ?? null,
      },
    });

    // Após cancel real: tira de "atraso" nas Cobranças (sync futuro sobrescreve se voltar).
    if (job.tipo === "cancel_subscription" && job.dry_run === false) {
      await markInfinityCancelledAfterSubscriptionCancel(supabase, {
        infinityCustomerId: job.infinity_customer_id,
        beneficiarioId: job.beneficiario_id,
        jobId: job.id,
      });
    }

    return data as InfinityJob;
  }

  const exhausted = job.attempts >= job.max_attempts;
  const { data, error } = await supabase
    .from("infinity_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      last_error: params.error?.slice(0, 500) || "falha sem detalhe",
      claimed_at: null,
      claimed_by: null,
      run_after: exhausted
        ? now
        : new Date(Date.now() + 5 * 60_000).toISOString(),
      completed_at: exhausted ? now : null,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await createLog(supabase, {
    acao: "infinity_job_failed",
    entidade: "infinity_jobs",
    entidade_id: params.jobId,
    payload: {
      tipo: job.tipo,
      dry_run: job.dry_run,
      error: params.error,
      exhausted,
    },
  });

  return data as InfinityJob;
}

export async function getInfinityJobsSummary(supabase: SupabaseClient) {
  const [{ count: pending }, { count: running }, { count: today }, cfg] =
    await Promise.all([
      supabase
        .from("infinity_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("infinity_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["claimed", "running"]),
      countInfinityJobsToday(supabase).then((n) => ({ count: n })),
      getInfinityConfigRaw(supabase),
    ]);

  const { data: recent } = await supabase
    .from("infinity_jobs")
    .select(
      "id, tipo, status, dry_run, last_error, created_at, completed_at, beneficiario_id, payload"
    )
    .order("created_at", { ascending: false })
    .limit(15);

  return {
    pending: pending ?? 0,
    running: running ?? 0,
    today: today ?? 0,
    teto: cfg.teto_diario_operacoes,
    dry_run: cfg.dry_run !== false,
    ativa: cfg.ativa === true,
    recent: recent ?? [],
  };
}
