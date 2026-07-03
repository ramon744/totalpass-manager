import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  analyzeSpreadsheet,
  getNovosDependentesCobraveis,
  type ImportPreviewRow,
} from "@/lib/services/import";

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
  let rowsOverride: ImportPreviewRow[] | undefined;
  if (rowsRaw) {
    try {
      rowsOverride = JSON.parse(rowsRaw);
    } catch {
      return NextResponse.json({ error: "Dados dos colaboradores inválidos" }, { status: 400 });
    }
  }

  if (!file) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const analysis = analyzeSpreadsheet(buffer, file.name);
    const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await createServiceClient()
      : supabase;

    const dependentesNovosCobraveis = await getNovosDependentesCobraveis(serviceClient, {
      buffer,
      fileName: file.name,
      provedorIdFixo: provedorId,
      rowsOverride,
    });

    return NextResponse.json({
      fileName: file.name,
      ...analysis,
      dependentesNovosCobraveis,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao analisar planilha" },
      { status: 400 }
    );
  }
}
