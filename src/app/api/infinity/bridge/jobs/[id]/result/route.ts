import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import { reportInfinityJobResult } from "@/lib/services/infinity-jobs";

export async function OPTIONS(request: NextRequest) {
  return infinityOptions(request, "POST, OPTIONS");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(request, { error: auth.error }, auth.status, "POST, OPTIONS");
  }
  if (!auth.ativa) {
    return infinityJson(
      request,
      { error: "Integração Infinity desligada.", ativa: false },
      503,
      "POST, OPTIONS"
    );
  }

  const { id } = await context.params;
  let body: {
    installationId?: string;
    status?: "succeeded" | "failed";
    result?: Record<string, unknown> | null;
    error?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return infinityJson(request, { error: "JSON inválido" }, 400, "POST, OPTIONS");
  }

  const installationId = String(body.installationId || "").trim();
  if (!installationId) {
    return infinityJson(
      request,
      { error: "installationId obrigatório" },
      400,
      "POST, OPTIONS"
    );
  }
  if (body.status !== "succeeded" && body.status !== "failed") {
    return infinityJson(
      request,
      { error: "status deve ser succeeded ou failed" },
      400,
      "POST, OPTIONS"
    );
  }

  try {
    const job = await reportInfinityJobResult(auth.supabase, {
      jobId: id,
      installationId,
      status: body.status,
      result: body.result ?? null,
      error: body.error ?? null,
    });
    return infinityJson(request, { ok: true, job }, 200, "POST, OPTIONS");
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : "Erro ao registrar resultado" },
      500,
      "POST, OPTIONS"
    );
  }
}
