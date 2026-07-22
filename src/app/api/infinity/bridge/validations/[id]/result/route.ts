import { NextRequest } from "next/server";
import {
  authenticateInfinityBridge,
  infinityJson,
  infinityOptions,
} from "@/lib/infinity-bridge/auth";
import { reportInfinityValidacao } from "@/lib/services/infinity-aviso-validacao";

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
      { ok: false, error: "Integração Infinity desligada", ativa: false },
      503,
      "POST, OPTIONS"
    );
  }

  const { id } = await context.params;
  let body: {
    installationId?: string;
    paymentStatus?: string;
    error?: string | null;
    details?: {
      paymentLink?: string | null;
      allowPaymentAfterDueDate?: boolean | null;
      invoiceSlug?: string | null;
      amount?: number | null;
      dueDate?: string | null;
      description?: string | null;
    } | null;
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

  try {
    const result = await reportInfinityValidacao(auth.supabase, {
      id,
      installationId,
      paymentStatus: String(body.paymentStatus || ""),
      error: body.error ?? null,
      details: body.details ?? null,
    });
    return infinityJson(request, { ...result, ok: true }, 200, "POST, OPTIONS");
  } catch (e) {
    return infinityJson(
      request,
      { error: e instanceof Error ? e.message : String(e) },
      500,
      "POST, OPTIONS"
    );
  }
}
