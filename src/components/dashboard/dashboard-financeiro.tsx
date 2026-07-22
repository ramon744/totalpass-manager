import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "@/types/database";

function FinanceGrid({
  cards,
}: {
  cards: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {card.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Financeiro do Dashboard: Asaas sempre; Infinity só se ativa.
 * Desligar Infinity na config → some o bloco (Asaas intacto).
 */
export function DashboardFinanceiroSection({ stats }: { stats: DashboardStats }) {
  const asaasCards = [
    { label: "Assinaturas ativas", value: stats.assinaturasAtivas },
    { label: "Cobranças pendentes", value: stats.cobrancasPendentes },
    { label: "Cobranças vencidas", value: stats.cobrancasVencidas },
    { label: "Receita prevista", value: formatCurrency(stats.receitaPrevista) },
    { label: "Receita recebida", value: formatCurrency(stats.receitaRecebida) },
    { label: "Inadimplência", value: `${stats.inadimplencia.toFixed(1)}%` },
  ];

  const showInfinity = stats.infinityAtiva && stats.infinity;
  const inf = stats.infinity;

  const infinityCards = inf
    ? [
        { label: "Clientes pagos", value: inf.pagas },
        { label: "Pendentes", value: inf.pendentes },
        { label: "Em atraso", value: inf.vencidas },
        {
          label: "Receita prevista",
          value: formatCurrency(inf.receitaPrevista),
        },
        {
          label: "Receita recebida",
          value: formatCurrency(inf.receitaRecebida),
        },
        {
          label: "Inadimplência",
          value: `${inf.inadimplencia.toFixed(1)}%`,
        },
      ]
    : [];

  const totalPrevista =
    stats.receitaPrevista + (inf?.receitaPrevista ?? 0);
  const totalRecebida =
    stats.receitaRecebida + (inf?.receitaRecebida ?? 0);
  const totalPendentes =
    stats.cobrancasPendentes + (inf?.pendentes ?? 0);
  const totalVencidas =
    stats.cobrancasVencidas + (inf?.vencidas ?? 0);

  const totalCards = showInfinity
    ? [
        { label: "Cobranças/clientes pendentes", value: totalPendentes },
        { label: "Cobranças/clientes em atraso", value: totalVencidas },
        {
          label: "Receita prevista (total)",
          value: formatCurrency(totalPrevista),
        },
        {
          label: "Receita recebida (total)",
          value: formatCurrency(totalRecebida),
        },
      ]
    : [];

  return (
    <section className="mt-8 space-y-6">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Financeiro</h2>
          <p className="text-sm text-slate-500">
            {showInfinity
              ? "Asaas e InfinitePay separados. Ao desligar a Infinity na Configurações, só o Asaas permanece."
              : "Valores das cobranças Asaas."}
          </p>
        </div>

        <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
          Asaas
        </h3>
        <FinanceGrid cards={asaasCards} />
      </div>

      {showInfinity && inf ? (
        <>
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
              InfinitePay
            </h3>
            <FinanceGrid cards={infinityCards} />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Total (Asaas + InfinitePay)
            </h3>
            <FinanceGrid cards={totalCards} />
          </div>
        </>
      ) : null}
    </section>
  );
}
