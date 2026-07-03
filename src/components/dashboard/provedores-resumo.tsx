import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableScroll } from "@/components/ui/table-scroll";
import type { ProvedorResumo } from "@/types/database";

function titularesTotal(p: ProvedorResumo) {
  return p.titularesAtivos + p.titularesElegiveis;
}

function dependentesTotal(p: ProvedorResumo) {
  return p.dependentesAtivos + p.dependentesElegiveis;
}

export function ProvedoresResumoPanel({
  provedores,
}: {
  provedores: ProvedorResumo[];
}) {
  if (provedores.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-slate-500">
          Nenhum provedor com beneficiários cadastrados.
        </CardContent>
      </Card>
    );
  }

  const totais = provedores.reduce(
    (acc, p) => ({
      ativos: acc.ativos + p.ativos,
      elegiveis: acc.elegiveis + p.elegiveis,
      inativos: acc.inativos + p.inativos,
      titularesAtivos: acc.titularesAtivos + p.titularesAtivos,
      titularesElegiveis: acc.titularesElegiveis + p.titularesElegiveis,
      dependentesAtivos: acc.dependentesAtivos + p.dependentesAtivos,
      dependentesElegiveis: acc.dependentesElegiveis + p.dependentesElegiveis,
      total: acc.total + p.total,
      totalGeral: acc.totalGeral + p.totalGeral,
    }),
    {
      ativos: 0,
      elegiveis: 0,
      inativos: 0,
      titularesAtivos: 0,
      titularesElegiveis: 0,
      dependentesAtivos: 0,
      dependentesElegiveis: 0,
      total: 0,
      totalGeral: 0,
    }
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Beneficiários por provedor
        </CardTitle>
        <p className="text-xs text-slate-500">
          Distribuição em cada provedor, com titulares e dependentes separados
          em ativos e elegíveis (sem inativos), igual ao TotalPass.
        </p>
      </CardHeader>
      <CardContent>
        <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th
                  rowSpan={2}
                  className="border-b border-slate-200 px-4 py-3 text-left font-medium dark:border-slate-800"
                >
                  Provedor
                </th>
                <th
                  colSpan={3}
                  className="border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-500 dark:border-slate-800"
                >
                  Geral
                </th>
                <th
                  colSpan={2}
                  className="border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-500 dark:border-slate-800"
                >
                  Titulares
                </th>
                <th
                  colSpan={2}
                  className="border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-500 dark:border-slate-800"
                >
                  Dependentes
                </th>
                <th
                  rowSpan={2}
                  className="border-b border-slate-200 px-4 py-3 text-center font-medium dark:border-slate-800"
                >
                  Total
                </th>
              </tr>
              <tr>
                <th className="px-2 py-2 text-center text-xs font-medium text-emerald-600">
                  Ativos
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-amber-600">
                  Elegíveis
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-red-600">
                  Inativos
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-emerald-600">
                  Ativos
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-amber-600">
                  Elegíveis
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-emerald-600">
                  Ativos
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-amber-600">
                  Elegíveis
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {provedores.map((p) => (
                <tr
                  key={p.id}
                  className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                >
                  <td className="px-4 py-3 font-medium">{p.nome}</td>
                  <td className="px-2 py-3 text-center font-semibold text-emerald-600">
                    {p.ativos}
                  </td>
                  <td className="px-2 py-3 text-center font-semibold text-amber-600">
                    {p.elegiveis}
                  </td>
                  <td className="px-2 py-3 text-center font-semibold text-red-600">
                    {p.inativos}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className="font-semibold text-emerald-600">
                      {p.titularesAtivos}
                    </span>
                    <span className="ml-1 text-xs text-slate-400">
                      / {titularesTotal(p)}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center font-semibold text-amber-600">
                    {p.titularesElegiveis}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className="font-semibold text-emerald-600">
                      {p.dependentesAtivos}
                    </span>
                    <span className="ml-1 text-xs text-slate-400">
                      / {dependentesTotal(p)}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center font-semibold text-amber-600">
                    {p.dependentesElegiveis}
                  </td>
                  <td className="px-4 py-3 text-center font-bold">
                    {p.total}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      / {p.totalGeral}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
              <tr className="font-semibold">
                <td className="px-4 py-3">Total geral</td>
                <td className="px-2 py-3 text-center text-emerald-600">
                  {totais.ativos}
                </td>
                <td className="px-2 py-3 text-center text-amber-600">
                  {totais.elegiveis}
                </td>
                <td className="px-2 py-3 text-center text-red-600">
                  {totais.inativos}
                </td>
                <td className="px-2 py-3 text-center text-emerald-600">
                  {totais.titularesAtivos}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    / {totais.titularesAtivos + totais.titularesElegiveis}
                  </span>
                </td>
                <td className="px-2 py-3 text-center text-amber-600">
                  {totais.titularesElegiveis}
                </td>
                <td className="px-2 py-3 text-center text-emerald-600">
                  {totais.dependentesAtivos}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    / {totais.dependentesAtivos + totais.dependentesElegiveis}
                  </span>
                </td>
                <td className="px-2 py-3 text-center text-amber-600">
                  {totais.dependentesElegiveis}
                </td>
                <td className="px-4 py-3 text-center">
                  {totais.total}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    / {totais.totalGeral}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </TableScroll>
        <p className="mt-3 text-xs text-slate-500">
          Em <strong>Titulares</strong> e <strong>Dependentes</strong>, o número
          em verde é a quantidade de ativos e o total ao lado (ex.: 53 / 66) é
          ativos + elegíveis. A coluna <strong>Total</strong> é a soma geral
          sem inativos / com inativos.
        </p>
      </CardContent>
    </Card>
  );
}
