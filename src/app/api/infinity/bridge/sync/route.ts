import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import {
  syncInfinityCustomers,
  type InfinityCustomerSyncItem,
} from "@/lib/services/infinity-bridge";

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
        error: "Integração Infinity desligada no Manager.",
        ativa: false,
      },
      503,
      "POST, OPTIONS"
    );
  }

  let body: { customers?: InfinityCustomerSyncItem[] };
  try {
    body = await request.json();
  } catch {
    return infinityJson(request, { error: "JSON inválido" }, 400, "POST, OPTIONS");
  }

  const customers = Array.isArray(body.customers) ? body.customers : [];
  if (customers.length === 0) {
    return infinityJson(
      request,
      { ok: true, upserted: 0, linked: 0, overdueCount: 0 },
      200,
      "POST, OPTIONS"
    );
  }

  try {
    const result = await syncInfinityCustomers(
      auth.supabase,
      customers,
      auth.userId
    );
    return infinityJson(
      request,
      { ok: true, ...result },
      200,
      "POST, OPTIONS"
    );
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : "Erro no sync" },
      500,
      "POST, OPTIONS"
    );
  }
}
