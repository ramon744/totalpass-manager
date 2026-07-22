import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import { upsertInfinityHeartbeat } from "@/lib/services/infinity-bridge";

export async function OPTIONS(request: NextRequest) {
  return infinityOptions(request, "POST, OPTIONS");
}

export async function POST(request: NextRequest) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(
      request,
      { error: auth.error },
      auth.status,
      "POST, OPTIONS"
    );
  }

  if (!auth.ativa) {
    return infinityJson(
      request,
      {
        ok: false,
        error:
          "Integração Infinity desligada no Manager (Configurações → InfinitePay).",
        ativa: false,
      },
      503,
      "POST, OPTIONS"
    );
  }

  let body: {
    installationId?: string;
    extensionVersion?: string | null;
    sessionOk?: boolean;
    sessionEmail?: string | null;
    lastError?: string | null;
    healthOk?: boolean | null;
    overdueCount?: number | null;
    recovering?: boolean | null;
  };

  try {
    body = await request.json();
  } catch {
    return infinityJson(request, { error: "JSON inválido" }, 400, "POST, OPTIONS");
  }

  const installationId = String(body.installationId || "").trim();
  if (!installationId || installationId.length > 128) {
    return infinityJson(
      request,
      { error: "installationId obrigatório" },
      400,
      "POST, OPTIONS"
    );
  }

  try {
    const result = await upsertInfinityHeartbeat(auth.supabase, {
      installationId,
      extensionVersion: body.extensionVersion ?? null,
      sessionOk: Boolean(body.sessionOk),
      sessionEmail: body.sessionEmail
        ? String(body.sessionEmail).slice(0, 200)
        : null,
      lastError: body.lastError ? String(body.lastError).slice(0, 500) : null,
      healthOk: body.healthOk == null ? null : Boolean(body.healthOk),
      overdueCount:
        body.overdueCount == null ? null : Number(body.overdueCount),
      recovering: body.recovering == null ? null : Boolean(body.recovering),
    });

    return infinityJson(
      request,
      {
        ok: true,
        ativa: true,
        overdueCount: result.overdueCount,
        serverTime: result.serverTime,
        sessionOk: result.instance.session_ok,
      },
      200,
      "POST, OPTIONS"
    );
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : "Erro no heartbeat" },
      500,
      "POST, OPTIONS"
    );
  }
}
