"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BeneficiarioResumo } from "@/types/database";
import type { BeneficiarioFiltro } from "@/lib/search";

function ResumoStatLink({
  href,
  count,
  label,
  valueClassName,
}: {
  href: string;
  count: number;
  label: string;
  valueClassName: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg bg-slate-50 p-3 text-center transition-colors hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
      title={`Ver ${label.toLowerCase()}`}
    >
      <p className={`text-2xl font-bold ${valueClassName}`}>{count}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </Link>
  );
}

function ResumoBloco({
  titulo,
  descricao,
  resumo,
  cor,
  perfil,
}: {
  titulo: string;
  descricao: string;
  resumo: BeneficiarioResumo;
  cor: "emerald" | "blue";
  perfil: "titular" | "dependente";
}) {
  const border =
    cor === "emerald"
      ? "border-emerald-200 dark:border-emerald-900"
      : "border-blue-200 dark:border-blue-900";
  const badge =
    cor === "emerald"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";

  const filtroPerfil: BeneficiarioFiltro = perfil;

  function hrefFiltro(status: BeneficiarioFiltro) {
    return `/beneficiarios?filtro=${status}&perfil=${perfil}`;
  }

  return (
    <Card className={border}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">{titulo}</CardTitle>
          <Link
            href={hrefFiltro(filtroPerfil)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 ${badge}`}
            title={`Ver todos os ${titulo.toLowerCase()}`}
          >
            Total: {resumo.total}
          </Link>
        </div>
        <p className="text-xs text-slate-500">{descricao}</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <ResumoStatLink
            href={hrefFiltro("ativo")}
            count={resumo.ativos}
            label="Ativos"
            valueClassName="text-emerald-600"
          />
          <ResumoStatLink
            href={hrefFiltro("elegivel")}
            count={resumo.elegiveis}
            label="Elegíveis"
            valueClassName="text-amber-600"
          />
          <ResumoStatLink
            href={hrefFiltro("inativo")}
            count={resumo.inativos}
            label="Inativos"
            valueClassName="text-red-600"
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Total sem inativos:{" "}
          <Link
            href={hrefFiltro(filtroPerfil)}
            className="font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
          >
            {resumo.total}
          </Link>{" "}
          (ativos + elegíveis)
        </p>
      </CardContent>
    </Card>
  );
}

export function BeneficiariosResumoPanel({
  titulares,
  dependentes,
  totalBeneficiarios,
}: {
  titulares: BeneficiarioResumo;
  dependentes: BeneficiarioResumo;
  totalBeneficiarios?: number;
}) {
  return (
    <div className="space-y-3">
      {totalBeneficiarios != null && (
        <p className="text-sm text-slate-500">
          <Link
            href="/beneficiarios?filtro=todos"
            className="font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
          >
            {totalBeneficiarios}
          </Link>{" "}
          beneficiários cadastrados no sistema
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ResumoBloco
          titulo="Titulares"
          descricao="Responsáveis pela cobrança. Inativos não entram no total."
          resumo={titulares}
          cor="emerald"
          perfil="titular"
        />
        <ResumoBloco
          titulo="Dependentes"
          descricao="Vinculados ao titular. Inativos não entram no total."
          resumo={dependentes}
          cor="blue"
          perfil="dependente"
        />
      </div>
    </div>
  );
}
