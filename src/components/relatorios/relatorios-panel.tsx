"use client";

import { BeneficiariosResumoPanel } from "@/components/beneficiarios/beneficiarios-resumo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { BeneficiarioResumo } from "@/types/database";
import { Download } from "lucide-react";

interface RelatorioStats {
  receitaPrevista: number;
  receitaRecebida: number;
  receitaAberta: number;
  titulares: BeneficiarioResumo;
  dependentes: BeneficiarioResumo;
  inadimplencia: number;
  planos: Array<{ plano: string; total: number }>;
}

export function RelatoriosPanel({ stats }: { stats: RelatorioStats }) {
  function exportar(formato: string, tipo: string) {
    window.open(`/api/reports/export?formato=${formato}&tipo=${tipo}`, "_blank");
  }

  const financeCards = [
    { label: "Receita prevista", value: formatCurrency(stats.receitaPrevista) },
    { label: "Receita recebida", value: formatCurrency(stats.receitaRecebida) },
    { label: "Receita em aberto", value: formatCurrency(stats.receitaAberta) },
    { label: "Inadimplência", value: `${stats.inadimplencia.toFixed(1)}%` },
  ];

  return (
    <div className="space-y-6">
      <BeneficiariosResumoPanel
        titulares={stats.titulares}
        dependentes={stats.dependentes}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {financeCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clientes por plano</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stats.planos.map((p) => (
              <div key={p.plano} className="flex justify-between text-sm">
                <span>{p.plano}</span>
                <span className="font-medium">{p.total}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-500">Financeiro</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => exportar("xlsx", "financeiro")}>
                <Download className="mr-2 h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" onClick={() => exportar("csv", "financeiro")}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" onClick={() => exportar("pdf", "financeiro")}>
                <Download className="mr-2 h-4 w-4" /> PDF
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-500">Beneficiários</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => exportar("xlsx", "beneficiarios")}>
                <Download className="mr-2 h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" onClick={() => exportar("csv", "beneficiarios")}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" onClick={() => exportar("pdf", "beneficiarios")}>
                <Download className="mr-2 h-4 w-4" /> PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
