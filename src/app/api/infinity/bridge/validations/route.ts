import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import { claimInfinityValidacoes } from "@/lib/services/infinity-aviso-validacao";

export async function OPTIONS(request: NextRequest) {
  return infinityOptions(request, "GET, OPTIONS");
}

/** Claim de validações pendentes (sync leve só desses IDs). */
export async function GET(request: NextRequest) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(request, { error: auth.error }, auth.status, "GET, OPTIONS");
  }
  if (!auth.ativa) {
    return infinityJson(
      request,
      { ok: false, error: "Integração Infinity desligada", ativa: false },
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

  const limit = Math.min(
    40,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 20))
  );

  try {
    const items = await claimInfinityValidacoes(
      auth.supabase,
      installationId,
      limit
    );
    return infinityJson(
      request,
      { ok: true, items },
      200,
      "GET, OPTIONS"
    );
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : String(e) },
      500,
      "GET, OPTIONS"
    );
  }
}
