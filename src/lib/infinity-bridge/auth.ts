import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getInfinityConfigRaw } from "@/lib/config";
import type { SupabaseClient } from "@supabase/supabase-js";

export function infinityCorsHeaders(
  request: NextRequest,
  methods = "GET, POST, OPTIONS"
) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin =
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
      ? origin
      : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-infinity-bridge-secret",
    "Access-Control-Max-Age": "86400",
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }

  return headers;
}

export function infinityJson(
  request: NextRequest,
  body: unknown,
  status = 200,
  methods?: string
) {
  return NextResponse.json(body, {
    status,
    headers: infinityCorsHeaders(request, methods),
  });
}

export function infinityOptions(request: NextRequest, methods?: string) {
  return new NextResponse(null, {
    status: 204,
    headers: infinityCorsHeaders(request, methods),
  });
}

export type InfinityAuthResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      userId: string | null;
      viaBridgeSecret: boolean;
      ativa: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Auth da ponte Infinity: cookie Supabase OU x-infinity-bridge-secret.
 * Segredo: env INFINITY_BRIDGE_SECRET ou config infinity.bridge_secret.
 */
export async function authenticateInfinityBridge(
  request: NextRequest
): Promise<InfinityAuthResult> {
  const supabaseAuth = await createClient();
  const {
    data: { user: cookieUser },
  } = await supabaseAuth.auth.getUser();

  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
      ? await createServiceClient()
      : null;

  if (cookieUser?.id) {
    const supabase = service ?? supabaseAuth;
    const infinity = await getInfinityConfigRaw(supabase);
    return {
      ok: true,
      supabase,
      userId: cookieUser.id,
      viaBridgeSecret: false,
      ativa: infinity.ativa,
    };
  }

  if (!service) {
    return {
      ok: false,
      status: 500,
      error:
        "SUPABASE_SERVICE_ROLE_KEY não configurada. Copie a service_role em Supabase → Settings → API.",
    };
  }

  const infinity = await getInfinityConfigRaw(service);
  const bridgeSecret = request.headers.get("x-infinity-bridge-secret")?.trim();
  const expected = infinity.bridge_secret?.trim();

  if (!bridgeSecret || !expected || bridgeSecret !== expected) {
    return {
      ok: false,
      status: 401,
      error:
        "Não autorizado. Faça login no Manager ou configure o segredo Infinity (x-infinity-bridge-secret / INFINITY_BRIDGE_SECRET).",
    };
  }

  return {
    ok: true,
    supabase: service,
    userId: process.env.INFINITY_BRIDGE_USER_ID?.trim() || null,
    viaBridgeSecret: true,
    ativa: infinity.ativa,
  };
}
