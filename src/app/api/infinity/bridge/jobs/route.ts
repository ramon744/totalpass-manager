import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import {
  claimInfinityJobs,
  reclaimStaleInfinityJobs,
} from "@/lib/services/infinity-jobs";

export async function OPTIONS(request: NextRequest) {
  return infinityOptions(request, "GET, OPTIONS");
}

/** Claim de jobs Infinity (create/cancel) para a extensão. */
export async function GET(request: NextRequest) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(request, { error: auth.error }, auth.status, "GET, OPTIONS");
  }
  if (!auth.ativa) {
    return infinityJson(
      request,
      { ok: false, error: "Integração Infinity desligada.", ativa: false, jobs: [] },
      503,
      "GET, OPTIONS"
    );
  }

  const installationId =
    request.nextUrl.searchParams.get("installationId")?.trim() || "";
  if (!installationId) {
    return infinityJson(
      request,
      { error: "installationId obrigatório" },
      400,
      "GET, OPTIONS"
    );
  }

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") || "3");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(10, Math.floor(limitRaw)))
    : 3;

  try {
    await reclaimStaleInfinityJobs(auth.supabase, 25);
    const jobs = await claimInfinityJobs(auth.supabase, installationId, limit);

    if (jobs.length) {
      await auth.supabase
        .from("infinity_jobs")
        .update({
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .in(
          "id",
          jobs.map((j) => j.id)
        );
    }

    return infinityJson(
      request,
      {
        ok: true,
        jobs: jobs.map((j) => ({
          id: j.id,
          tipo: j.tipo,
          dry_run: j.dry_run,
          infinityCustomerId: j.infinity_customer_id,
          infinitySubscriptionSlug: j.infinity_subscription_slug,
          beneficiarioId: j.beneficiario_id,
          payload: j.payload,
          attempts: j.attempts,
        })),
      },
      200,
      "GET, OPTIONS"
    );
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : "Erro ao buscar jobs" },
      500,
      "GET, OPTIONS"
    );
  }
}
