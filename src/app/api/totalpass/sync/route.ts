import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { processImport } from "@/lib/services/import";

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin =
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
      ? origin
      : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function json(
  request: NextRequest,
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(request),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

/**
 * Ponte da extensão TotalPass Bridge → importação no Manager.
 * Auth: sessão Supabase (cookie) OU header x-tp-bridge-secret == TOTALPASS_BRIDGE_SECRET.
 */
export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user: cookieUser },
  } = await supabaseAuth.auth.getUser();

  let userId: string | null = cookieUser?.id ?? null;
  let viaBridgeSecret = false;

  if (!userId) {
    const bridgeSecret = request.headers.get("x-tp-bridge-secret")?.trim();
    const expected = process.env.TOTALPASS_BRIDGE_SECRET?.trim();
    if (bridgeSecret && expected && bridgeSecret === expected) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return json(
          request,
          { error: "Service role não configurada no servidor" },
          500
        );
      }
      const service = await createServiceClient();
      const { data: admin } = await service
        .from("usuarios")
        .select("id")
        .eq("role", "admin")
        .eq("ativo", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!admin?.id) {
        return json(
          request,
          { error: "Nenhum admin ativo encontrado para a ponte" },
          403
        );
      }
      userId = admin.id;
      viaBridgeSecret = true;
    }
  }

  if (!userId) {
    return json(
      request,
      {
        error:
          "Não autorizado. Faça login no Manager ou configure o segredo da ponte (x-tp-bridge-secret).",
      },
      401
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(request, { error: "FormData inválido" }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json(request, { error: "Arquivo obrigatório" }, 400);
  }

  const provedorId =
    (formData.get("provedorId") as string | null)?.trim() || undefined;

  const buffer = await file.arrayBuffer();
  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabaseAuth;

  try {
    const result = await processImport(serviceClient, {
      buffer,
      fileName: file.name || "totalpass-export.csv",
      userId,
      provedorIdFixo: provedorId,
    });

    return json(request, {
      ...result,
      origem: "totalpass_bridge",
      viaBridgeSecret,
    });
  } catch (e) {
    return json(
      request,
      { error: e instanceof Error ? e.message : "Erro na importação" },
      500
    );
  }
}
