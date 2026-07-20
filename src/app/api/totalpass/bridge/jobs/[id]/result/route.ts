import { NextRequest } from "next/server";
import {
  authenticateBridge,
  bridgeJson,
  bridgeOptions,
} from "@/lib/totalpass-bridge/auth";
import { reportBridgeJobResult } from "@/lib/services/bridge-jobs";

export async function OPTIONS(request: NextRequest) {
  return bridgeOptions(request, "POST, OPTIONS");
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await authenticateBridge(request);
  if (!auth.ok) {
    return bridgeJson(request, { error: auth.error }, auth.status, "POST, OPTIONS");
  }

  const { id } = await context.params;
  if (!id) {
    return bridgeJson(request, { error: "id obrigatório" }, 400, "POST, OPTIONS");
  }

  let body: {
    installationId?: string;
    status?: "succeeded" | "failed";
    result?: Record<string, unknown> | null;
    error?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return bridgeJson(request, { error: "JSON inválido" }, 400, "POST, OPTIONS");
  }

  const installationId = String(body.installationId || "").trim();
  if (!installationId) {
    return bridgeJson(
      request,
      { error: "installationId obrigatório" },
      400,
      "POST, OPTIONS"
    );
  }

  if (body.status !== "succeeded" && body.status !== "failed") {
    return bridgeJson(
      request,
      { error: "status deve ser succeeded ou failed" },
      400,
      "POST, OPTIONS"
    );
  }

  // Sanitiza result (sem tokens)
  const result = body.result
    ? {
        tp_employee_id: body.result.tp_employee_id ?? null,
        removed_at: body.result.removed_at ?? null,
        already_removed: body.result.already_removed ?? false,
        name: typeof body.result.name === "string"
          ? String(body.result.name).slice(0, 120)
          : null,
      }
    : null;

  try {
    const out = await reportBridgeJobResult(auth.supabase, {
      jobId: id,
      installationId,
      status: body.status,
      result,
      error: body.error ? String(body.error).slice(0, 500) : null,
      userId: auth.userId,
    });

    return bridgeJson(
      request,
      {
        ok: true,
        jobId: out.job.id,
        status: out.job.status,
        alreadyFinal: out.alreadyFinal,
      },
      200,
      "POST, OPTIONS"
    );
  } catch (e) {
    return bridgeJson(
      request,
      { error: e instanceof Error ? e.message : "Erro ao reportar resultado" },
      500,
      "POST, OPTIONS"
    );
  }
}
