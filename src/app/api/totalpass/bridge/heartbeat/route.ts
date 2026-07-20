import { NextRequest } from "next/server";
import {
  authenticateBridge,
  bridgeJson,
  bridgeOptions,
} from "@/lib/totalpass-bridge/auth";
import { upsertBridgeHeartbeat } from "@/lib/services/bridge-jobs";

export async function OPTIONS(request: NextRequest) {
  return bridgeOptions(request, "POST, OPTIONS");
}

export async function POST(request: NextRequest) {
  const auth = await authenticateBridge(request);
  if (!auth.ok) {
    return bridgeJson(request, { error: auth.error }, auth.status, "POST, OPTIONS");
  }

  let body: {
    installationId?: string;
    extensionVersion?: string;
    sessionOk?: boolean;
    sessionEmail?: string | null;
    lastError?: string | null;
    healthOk?: boolean | null;
  };

  try {
    body = await request.json();
  } catch {
    return bridgeJson(request, { error: "JSON inválido" }, 400, "POST, OPTIONS");
  }

  const installationId = String(body.installationId || "").trim();
  if (!installationId || installationId.length > 128) {
    return bridgeJson(
      request,
      { error: "installationId obrigatório" },
      400,
      "POST, OPTIONS"
    );
  }

  try {
    const result = await upsertBridgeHeartbeat(auth.supabase, {
      installationId,
      extensionVersion: body.extensionVersion ?? null,
      sessionOk: Boolean(body.sessionOk),
      sessionEmail: body.sessionEmail
        ? String(body.sessionEmail).slice(0, 200)
        : null,
      lastError: body.lastError ? String(body.lastError).slice(0, 500) : null,
      healthOk:
        body.healthOk == null ? null : Boolean(body.healthOk),
    });

    return bridgeJson(
      request,
      {
        ok: true,
        pendingCount: result.pendingCount,
        serverTime: result.serverTime,
        sessionOk: result.instance.session_ok,
      },
      200,
      "POST, OPTIONS"
    );
  } catch (e) {
    return bridgeJson(
      request,
      { error: e instanceof Error ? e.message : "Erro no heartbeat" },
      500,
      "POST, OPTIONS"
    );
  }
}
