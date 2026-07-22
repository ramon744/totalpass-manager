import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import { listInfinityEnrichSnapshots } from "@/lib/services/infinity-aviso-validacao";

export async function OPTIONS(request: NextRequest) {
  return infinityOptions(request, "GET, POST, OPTIONS");
}

/** Pagos já completos no banco — extensão pula enrich neles. */
export async function GET(request: NextRequest) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(request, { error: auth.error }, auth.status, "GET, POST, OPTIONS");
  }
  if (!auth.ativa) {
    return infinityJson(
      request,
      { ok: false, error: "Integração Infinity desligada", ativa: false },
      503,
      "GET, POST, OPTIONS"
    );
  }

  try {
    const result = await listInfinityEnrichSnapshots(auth.supabase);
    return infinityJson(request, { ok: true, ...result }, 200, "GET, POST, OPTIONS");
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : String(e) },
      500,
      "GET, POST, OPTIONS"
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateInfinityBridge(request);
  if (!auth.ok) {
    return infinityJson(request, { error: auth.error }, auth.status, "GET, POST, OPTIONS");
  }
  if (!auth.ativa) {
    return infinityJson(
      request,
      { ok: false, error: "Integração Infinity desligada", ativa: false },
      503,
      "GET, POST, OPTIONS"
    );
  }

  let body: { customerIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const result = await listInfinityEnrichSnapshots(
      auth.supabase,
      Array.isArray(body.customerIds) ? body.customerIds.map(String) : undefined
    );
    return infinityJson(request, { ok: true, ...result }, 200, "GET, POST, OPTIONS");
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : String(e) },
      500,
      "GET, POST, OPTIONS"
    );
  }
}
