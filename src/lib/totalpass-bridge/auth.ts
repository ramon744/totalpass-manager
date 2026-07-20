import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export function bridgeCorsHeaders(
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
      "Content-Type, Authorization, x-tp-bridge-secret",
    "Access-Control-Max-Age": "86400",
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }

  return headers;
}

export function bridgeJson(
  request: NextRequest,
  body: unknown,
  status = 200,
  methods?: string
) {
  return NextResponse.json(body, {
    status,
    headers: bridgeCorsHeaders(request, methods),
  });
}

export function bridgeOptions(request: NextRequest, methods?: string) {
  return new NextResponse(null, {
    status: 204,
    headers: bridgeCorsHeaders(request, methods),
  });
}

export type BridgeAuthResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      userId: string | null;
      viaBridgeSecret: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Auth da ponte: cookie Supabase OU x-tp-bridge-secret.
 * Sempre retorna service client quando autenticado via secret.
 */
export async function authenticateBridge(
  request: NextRequest
): Promise<BridgeAuthResult> {
  const supabaseAuth = await createClient();
  const {
    data: { user: cookieUser },
  } = await supabaseAuth.auth.getUser();

  if (cookieUser?.id) {
    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await createServiceClient()
      : supabaseAuth;
    return {
      ok: true,
      supabase,
      userId: cookieUser.id,
      viaBridgeSecret: false,
    };
  }

  const bridgeSecret = request.headers.get("x-tp-bridge-secret")?.trim();
  const expected = process.env.TOTALPASS_BRIDGE_SECRET?.trim();

  if (!bridgeSecret || !expected || bridgeSecret !== expected) {
    return {
      ok: false,
      status: 401,
      error:
        "Não autorizado. Faça login no Manager ou configure o segredo da ponte (x-tp-bridge-secret).",
    };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return {
      ok: false,
      status: 500,
      error:
        "SUPABASE_SERVICE_ROLE_KEY não configurada. Copie a service_role em Supabase → Settings → API.",
    };
  }

  try {
    const supabase = await createServiceClient();
    return {
      ok: true,
      supabase,
      userId: process.env.TOTALPASS_BRIDGE_USER_ID?.trim() || null,
      viaBridgeSecret: true,
    };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error:
        e instanceof Error
          ? e.message
          : "Falha ao criar cliente service role",
    };
  }
}
