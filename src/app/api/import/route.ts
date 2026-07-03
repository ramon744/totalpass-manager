import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { processImport, type ImportPreviewRow } from "@/lib/services/import";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const provedorId = (formData.get("provedorId") as string | null)?.trim() || undefined;
  const rowsRaw = formData.get("rows") as string | null;
  const dependentesCobrancaRaw = formData.get("dependentesCobrancaCpfAprovados") as
    | string
    | null;
  let rowsOverride: ImportPreviewRow[] | undefined;
  let dependentesCobrancaCpfAprovados: string[] | undefined;
  if (rowsRaw) {
    try {
      rowsOverride = JSON.parse(rowsRaw);
    } catch {
      return NextResponse.json({ error: "Dados dos colaboradores inválidos" }, { status: 400 });
    }
  }
  if (dependentesCobrancaRaw) {
    try {
      dependentesCobrancaCpfAprovados = JSON.parse(dependentesCobrancaRaw);
    } catch {
      return NextResponse.json({ error: "Lista de dependentes inválida" }, { status: 400 });
    }
  }

  if (!file) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    const result = await processImport(serviceClient, {
      buffer,
      fileName: file.name,
      userId: user.id,
      provedorIdFixo: provedorId,
      rowsOverride,
      dependentesCobrancaCpfAprovados,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na importação" },
      { status: 500 }
    );
  }
}
