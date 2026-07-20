import { NextRequest } from "next/server";
import {
  authenticateBridge,
  bridgeJson,
  bridgeOptions,
} from "@/lib/totalpass-bridge/auth";
import { claimBridgeJobs, reclaimStaleBridgeJobs, cancelObsoleteInactivationJobs } from "@/lib/services/bridge-jobs";

export async function OPTIONS(request: NextRequest) {
  return bridgeOptions(request, "GET, OPTIONS");
}

/**
 * Reserva (claim) até N jobs pendentes para a instalação da extensão.
 * Query: installationId (obrigatório), limit (opcional, max 10)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateBridge(request);
  if (!auth.ok) {
    return bridgeJson(request, { error: auth.error }, auth.status, "GET, OPTIONS");
  }

  const installationId =
    request.nextUrl.searchParams.get("installationId")?.trim() || "";
  if (!installationId) {
    return bridgeJson(
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
    // Extensão caiu no meio → devolve jobs claimed/running antigos à fila
    await reclaimStaleBridgeJobs(auth.supabase, 25);
    // Já desvinculado manual no Manager → não manda de novo para o HR
    await cancelObsoleteInactivationJobs(auth.supabase);

    const jobs = await claimBridgeJobs(auth.supabase, installationId, limit);

    // Marca running ao entregar
    if (jobs.length) {
      await auth.supabase
        .from("bridge_jobs")
        .update({
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .in(
          "id",
          jobs.map((j) => j.id)
        );
    }

    return bridgeJson(
      request,
      {
        ok: true,
        jobs: jobs.map((j) => ({
          id: j.id,
          tipo: j.tipo,
          cpf: j.cpf,
          motivo: j.motivo,
          payload: j.payload,
          attempts: j.attempts,
        })),
      },
      200,
      "GET, OPTIONS"
    );
  } catch (e) {
    return bridgeJson(
      request,
      { error: e instanceof Error ? e.message : "Erro ao buscar jobs" },
      500,
      "GET, OPTIONS"
    );
  }
}
