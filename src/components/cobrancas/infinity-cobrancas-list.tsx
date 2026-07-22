"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { formatCurrency, formatDate, formatDateTime, formatCpf } from "@/lib/utils";
import { matchesPerson, scorePerson, sortBySearchScore } from "@/lib/search";
import { formatInfinityPaymentStatus } from "@/lib/infinity-payment-status";
import { CopyableValue } from "@/components/ui/copyable-value";
import type { InfinityCobrancaRow } from "@/components/cobrancas/cobrancas-tabs";

const statusVariant: Record<
  string,
  "success" | "warning" | "danger" | "default"
> = {
  paid: "success",
  pending: "warning",
  overdue: "danger",
  unknown: "default",
  inactive: "default",
  cancelled: "default",
};

function matchesFiltro(row: InfinityCobrancaRow, filtro: string) {
  if (filtro === "todos") return true;
  if (filtro === "pagas") return row.payment_status === "paid";
  if (filtro === "pendentes") return row.payment_status === "pending";
  if (filtro === "vencidas") return row.payment_status === "overdue";
  if (filtro === "sem_fatura")
    return (
      row.payment_status === "unknown" ||
      row.payment_status === "inactive" ||
      row.payment_status === "cancelled"
    );
  return true;
}

function notifLabel(row: InfinityCobrancaRow) {
  const parts: string[] = [];
  if (row.notified_email) parts.push("e-mail");
  if (row.notified_whatsapp) parts.push("WhatsApp");
  if (!parts.length) return "—";
  return parts.join(" · ");
}

export function InfinityCobrancasList({
  rows,
}: {
  rows: InfinityCobrancaRow[];
}) {
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = rows.filter((r) => {
      const nome = r.beneficiario?.nome || r.nome || "";
      const cpf = r.beneficiario?.cpf || r.document_number || "";
      const matchBusca =
        !busca.trim() ||
        matchesPerson({ nome, cpf, telefone: r.phone }, busca);
      if (!matchBusca) return false;
      return matchesFiltro(r, filtro);
    });

    if (busca.trim()) {
      list = sortBySearchScore(list, busca, (r) =>
        scorePerson(
          {
            nome: r.beneficiario?.nome || r.nome || "",
            cpf: r.beneficiario?.cpf || r.document_number || "",
            telefone: r.phone,
          },
          busca
        )
      );
    } else {
      const rank: Record<string, number> = {
        overdue: 0,
        pending: 1,
        paid: 2,
        unknown: 3,
        inactive: 4,
      };
      list = [...list].sort((a, b) => {
        const ra = rank[a.payment_status] ?? 9;
        const rb = rank[b.payment_status] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.nome || "").localeCompare(b.nome || "", "pt-BR");
      });
    }

    return list;
  }, [rows, filtro, busca]);

  const resumo = useMemo(() => {
    const overdue = rows.filter((r) => r.payment_status === "overdue").length;
    const pending = rows.filter((r) => r.payment_status === "pending").length;
    const paid = rows.filter((r) => r.payment_status === "paid").length;
    return { overdue, pending, paid, total: rows.length };
  }, [rows]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
        Status + detalhes da InfinitePay via extensão <strong>v0.1.16+</strong>{" "}
        (só leitura). Se valor/pago/notif. aparecerem como “—”, rode{" "}
        <strong>Sincronizar agora</strong> de novo após recarregar a extensão —
        o enriquecimento de faturas é separado da lista de clientes. Baixa manual
        conta como pago.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por nome, CPF ou telefone…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-md"
        />
        <div className="flex flex-wrap gap-2">
          {[
            { id: "todos", label: `Todos (${resumo.total})` },
            { id: "vencidas", label: `Em atraso (${resumo.overdue})` },
            { id: "pendentes", label: `Pendentes (${resumo.pending})` },
            { id: "pagas", label: `Pagas (${resumo.paid})` },
            { id: "sem_fatura", label: "Sem fatura" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                filtro === f.id
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cliente</th>
              <th className="px-4 py-3 text-left font-medium">Valor</th>
              <th className="px-4 py-3 text-left font-medium">Vencimento</th>
              <th className="px-4 py-3 text-left font-medium">Pago em</th>
              <th className="px-4 py-3 text-left font-medium">Notif. Infinity</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Nenhum cliente Infinity neste filtro. Rode o sync da extensão
                  v0.1.9+ se a lista estiver vazia.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const nome = r.beneficiario?.nome || r.nome || "—";
                const cpf = r.beneficiario?.cpf || r.document_number || "";
                const aberto = expanded.has(r.id);
                const temFaturas = (r.invoices?.length ?? 0) > 0;
                return (
                  <Fragment key={r.id}>
                    <tr className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left font-medium"
                          onClick={() => toggle(r.id)}
                          disabled={!temFaturas && !r.invoice_description}
                        >
                          {temFaturas || r.invoice_description ? (
                            aberto ? (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" />
                            )
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                          <span>{nome}</span>
                          {temFaturas ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {r.invoices.length} fatura(s)
                            </span>
                          ) : null}
                        </button>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-6 text-xs text-slate-500">
                          {cpf ? (
                            <CopyableValue
                              value={cpf}
                              mode="cpf"
                              display={formatCpf(cpf)}
                              className="text-xs text-slate-500"
                            />
                          ) : (
                            <span>sem CPF</span>
                          )}
                          {r.invoice_description ? (
                            <span>· {r.invoice_description}</span>
                          ) : null}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {r.amount != null
                          ? formatCurrency(Number(r.amount))
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.due_date ? formatDate(r.due_date) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.paid_at ? formatDateTime(r.paid_at) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {notifLabel(r)}
                        {r.last_notified_at ? (
                          <span className="mt-0.5 block text-slate-400">
                            {formatDateTime(r.last_notified_at)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={statusVariant[r.payment_status] ?? "default"}
                        >
                          {formatInfinityPaymentStatus(r.payment_status)}
                        </Badge>
                      </td>
                    </tr>
                    {aberto &&
                      (r.invoices?.length
                        ? r.invoices
                        : [
                            {
                              id: `${r.id}-snap`,
                              infinity_invoice_slug: r.invoice_slug || "—",
                              status: r.payment_status,
                              amount: r.amount,
                              due_date: r.due_date,
                              paid_at: r.paid_at,
                              description: r.invoice_description,
                              notified_email: r.notified_email,
                              notified_whatsapp: r.notified_whatsapp,
                              synced_at: r.synced_at,
                            },
                          ]
                      ).map((inv) => (
                        <tr
                          key={inv.id}
                          className="bg-slate-50/60 dark:bg-slate-900/50"
                        >
                          <td className="px-4 py-2 pl-10 text-slate-600 dark:text-slate-400">
                            {inv.description ||
                              `Fatura ${inv.infinity_invoice_slug}`}
                          </td>
                          <td className="px-4 py-2">
                            {inv.amount != null
                              ? formatCurrency(Number(inv.amount))
                              : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {inv.due_date ? formatDate(inv.due_date) : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {inv.paid_at ? formatDateTime(inv.paid_at) : "—"}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {[
                              inv.notified_email ? "e-mail" : null,
                              inv.notified_whatsapp ? "WhatsApp" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={statusVariant[inv.status] ?? "default"}
                            >
                              {formatInfinityPaymentStatus(inv.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
