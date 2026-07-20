"use client";

import Link from "next/link";
import { formatCpf, formatCurrency } from "@/lib/utils";
import type { DesvinculoPendenteManual } from "@/lib/services/overdue-inactivation";

/**
 * Bloco operacional: prazos de desvínculo vencidos (ação em Beneficiários).
 * Visual alinhado aos painéis existentes de Cobranças — sem redesign.
 */
export function DesvinculosPendentesPanel({
  itens,
}: {
  itens: DesvinculoPendenteManual[];
}) {
  if (!itens.length) return null;

  return (
    <div
      id="desvinculos-pendentes"
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Desvínculo — prazo vencido ({itens.length})
        </h2>
        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
          Aviso já enviado e data limite passou. Se a extensão estiver offline,
          use o desvínculo manual em Beneficiários (ícone de link). Quem já foi
          tratado some desta lista.
        </p>
      </div>
      <ul className="divide-y divide-amber-200/80 dark:divide-amber-900/40">
        {itens.map((p) => (
          <li
            key={p.avisoId}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <div className="min-w-0">
              <Link
                href={`/beneficiarios?q=${encodeURIComponent(p.nome)}`}
                className="font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
              >
                {p.nome}
              </Link>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {formatCpf(p.cpf)} · venc.{" "}
                {p.vencimento.split("-").reverse().join("/")} · limite{" "}
                {p.dataLimite.split("-").reverse().join("/")}
                {p.temAssinaturaAtiva ? " · assinatura ativa" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-medium tabular-nums">
                {formatCurrency(p.valor)}
              </span>
              <Link
                href={`/beneficiarios?q=${encodeURIComponent(p.nome)}`}
                className="text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
              >
                Abrir
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
