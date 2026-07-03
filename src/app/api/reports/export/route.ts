import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const tipo = request.nextUrl.searchParams.get("tipo") ?? "financeiro";
    const formato = request.nextUrl.searchParams.get("formato") ?? "xlsx";

    let data: Record<string, unknown>[] = [];

    if (tipo === "financeiro") {
      const { data: cobrancas, error } = await supabase
        .from("cobrancas")
        .select(
          "valor, status, vencimento, data_pagamento, beneficiario:beneficiarios(nome, cpf)"
        )
        .order("vencimento", { ascending: false });

      if (error) throw error;

      data = (cobrancas ?? []).map((c) => {
        const b = Array.isArray(c.beneficiario)
          ? c.beneficiario[0]
          : c.beneficiario;
        return {
          Cliente: (b as { nome?: string })?.nome ?? "",
          CPF: (b as { cpf?: string })?.cpf ?? "",
          Valor: c.valor,
          Status: c.status,
          Vencimento: c.vencimento,
          Pagamento: c.data_pagamento,
        };
      });
    } else if (tipo === "beneficiarios") {
      const { data: beneficiarios, error } = await supabase
        .from("beneficiarios")
        .select("*")
        .order("nome");

      if (error) throw error;

      data = (beneficiarios ?? []).map((b) => ({
        Nome: b.nome,
        CPF: b.cpf,
        Perfil: b.perfil,
        Status: b.status_totalpass,
        Plano: b.plano,
        Telefone: b.telefone,
        Email: b.email,
      }));
    }

    if (data.length === 0) {
      data = [{ Aviso: "Nenhum dado disponível para exportação" }];
    }

    if (formato === "csv") {
      const ws = XLSX.utils.json_to_sheet(data);
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new NextResponse("\uFEFF" + csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=relatorio-${tipo}.csv`,
        },
      });
    }

    if (formato === "pdf") {
      const doc = new jsPDF();
      const columns = Object.keys(data[0]);
      const rows = data.map((row) => columns.map((col) => String(row[col] ?? "")));

      doc.text(`Relatório - ${tipo}`, 14, 16);
      autoTable(doc, {
        head: [columns],
        body: rows,
        startY: 22,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [5, 150, 105] },
      });

      const pdfBuffer = doc.output("arraybuffer");
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename=relatorio-${tipo}.pdf`,
        },
      });
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=relatorio-${tipo}.xlsx`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao exportar" },
      { status: 500 }
    );
  }
}
