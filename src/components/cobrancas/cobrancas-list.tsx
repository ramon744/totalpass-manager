"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  statusLabel,
} from "@/lib/utils";
import { matchesPerson, scorePerson, sortBySearchScore } from "@/lib/search";
import type { Beneficiario, Cobranca } from "@/types/database";

type CobrancaComBeneficiario = Cobranca & {
  beneficiario: Beneficiario | Beneficiario[] | null;
};

type GrupoCobrancas = {
  id: string;
  beneficiario: Beneficiario | null;
  cobrancas: CobrancaComBeneficiario[];
  total: number;
  totalPendente: number;
  pagas: number;
  pendentes: number;
  vencidas: number;
  canceladas: number;
};

const statusVariant: Record<string, "success" | "warning" | "danger" | "default"> = {
  RECEIVED: "success",
  CONFIRMED: "success",
  PENDING: "warning",
  OVERDUE: "danger",
  DELETED: "default",
  REFUNDED: "default",
};

function getBeneficiario(cobranca: CobrancaComBeneficiario) {
  return Array.isArray(cobranca.beneficiario)
    ? cobranca.beneficiario[0] ?? null
    : cobranca.beneficiario;
}

function matchesFiltro(cobranca: CobrancaComBeneficiario, filtro: string) {
  if (filtro === "todos") return true;
  if (filtro === "pagas") return ["RECEIVED", "CONFIRMED"].includes(cobranca.status);
  if (filtro === "pendentes") return cobranca.status === "PENDING";
  if (filtro === "vencidas") return cobranca.status === "OVERDUE";
  if (filtro === "canceladas") return ["DELETED", "REFUNDED"].includes(cobranca.status);
  return true;
}

function statusResumo(grupo: GrupoCobrancas) {
  const parts = [
    grupo.pendentes > 0 ? `${grupo.pendentes} pendente(s)` : null,
    grupo.vencidas > 0 ? `${grupo.vencidas} vencida(s)` : null,
    grupo.pagas > 0 ? `${grupo.pagas} paga(s)` : null,
    grupo.canceladas > 0 ? `${grupo.canceladas} cancelada(s)` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "Sem cobranças";
}

export function CobrancasList({
  cobrancas,
}: {
  cobrancas: CobrancaComBeneficiario[];
}) {
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = cobrancas.filter((c) => {
      const b = Array.isArray(c.beneficiario) ? c.beneficiario[0] : c.beneficiario;
      const matchBusca =
        !busca.trim() ||
        matchesPerson(
          { nome: b?.nome ?? "", cpf: b?.cpf ?? "", telefone: b?.telefone },
          busca
        );

      if (!matchBusca) return false;

      return matchesFiltro(c, filtro);
    });

    if (busca.trim()) {
      list = sortBySearchScore(list, busca, (c) => {
        const b = Array.isArray(c.beneficiario) ? c.beneficiario[0] : c.beneficiario;
        return scorePerson(
          { nome: b?.nome ?? "", cpf: b?.cpf ?? "", telefone: b?.telefone },
          busca
        );
      });
    }

    return list;
  }, [cobrancas, filtro, busca]);

  const grupos = useMemo(() => {
    const map = new Map<string, GrupoCobrancas>();

    for (const cobranca of filtered) {
      const beneficiario = getBeneficiario(cobranca);
      const id = beneficiario?.id ?? cobranca.beneficiario_id ?? cobranca.id;
      const grupo =
        map.get(id) ??
        ({
          id,
          beneficiario,
          cobrancas: [],
          total: 0,
          totalPendente: 0,
          pagas: 0,
          pendentes: 0,
          vencidas: 0,
          canceladas: 0,
        } satisfies GrupoCobrancas);

      grupo.cobrancas.push(cobranca);
      grupo.total += Number(cobranca.valor);

      if (["RECEIVED", "CONFIRMED"].includes(cobranca.status)) {
        grupo.pagas++;
      } else if (cobranca.status === "PENDING") {
        grupo.pendentes++;
        grupo.totalPendente += Number(cobranca.valor);
      } else if (cobranca.status === "OVERDUE") {
        grupo.vencidas++;
        grupo.totalPendente += Number(cobranca.valor);
      } else if (["DELETED", "REFUNDED"].includes(cobranca.status)) {
        grupo.canceladas++;
      }

      map.set(id, grupo);
    }

    const list = Array.from(map.values());
    if (!busca.trim()) return list;

    return sortBySearchScore(list, busca, (grupo) =>
      scorePerson(
        {
          nome: grupo.beneficiario?.nome ?? "",
          cpf: grupo.beneficiario?.cpf ?? "",
          telefone: grupo.beneficiario?.telefone,
        },
        busca
      )
    );
  }, [filtered, busca]);

  useEffect(() => {
    if (!busca.trim() && filtro === "todos") return;
    setExpanded(new Set(grupos.map((grupo) => grupo.id)));
  }, [busca, filtro, grupos]);

  const filtros = [
    { id: "todos", label: "Todos" },
    { id: "pagas", label: "Pagas" },
    { id: "pendentes", label: "Pendentes" },
    { id: "vencidas", label: "Vencidas" },
    { id: "canceladas", label: "Canceladas" },
  ];

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="max-w-sm"
          placeholder="Buscar por nome, CPF ou telefone..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {filtros.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                filtro === f.id
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cliente</th>
              <th className="px-4 py-3 text-left font-medium">Valor</th>
              <th className="px-4 py-3 text-left font-medium">Vencimento</th>
              <th className="px-4 py-3 text-left font-medium">Pagamento</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {grupos.map((grupo) => {
              const aberto = expanded.has(grupo.id);
              const principal =
                grupo.cobrancas.find((c) =>
                  ["PENDING", "OVERDUE"].includes(c.status)
                ) ?? grupo.cobrancas[0];
              const destaque =
                grupo.vencidas > 0
                  ? "OVERDUE"
                  : grupo.pendentes > 0
                    ? "PENDING"
                    : grupo.pagas > 0
                      ? "RECEIVED"
                      : grupo.canceladas > 0
                        ? "DELETED"
                        : principal?.status;

              return (
                <Fragment key={grupo.id}>
                  <tr className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <td className="px-4 py-3">
                      <button
                        className="flex items-center gap-2 text-left font-medium"
                        onClick={() => toggleExpand(grupo.id)}
                      >
                        {aberto ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <span>{grupo.beneficiario?.nome ?? "-"}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {grupo.cobrancas.length} cobrança(s)
                        </span>
                      </button>
                      <p className="mt-1 pl-6 text-xs text-slate-500">
                        {statusResumo(grupo)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{formatCurrency(grupo.total)}</div>
                      {grupo.totalPendente > 0 && (
                        <p className="text-xs text-amber-600">
                          {formatCurrency(grupo.totalPendente)} em aberto
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {principal ? formatDate(principal.vencimento) : "-"}
                    </td>
                    <td className="px-4 py-3">-</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[destaque] ?? "default"}>
                        {statusLabel(destaque)}
                      </Badge>
                    </td>
                  </tr>

                  {aberto &&
                    grupo.cobrancas.map((c) => (
                      <tr
                        key={c.id}
                        className="bg-slate-50/60 dark:bg-slate-900/50"
                      >
                        <td className="px-4 py-2 pl-10 text-slate-600 dark:text-slate-400">
                          Fatura
                        </td>
                        <td className="px-4 py-2">{formatCurrency(Number(c.valor))}</td>
                        <td className="px-4 py-2">{formatDate(c.vencimento)}</td>
                        <td className="px-4 py-2">
                          {formatDateTime(c.data_pagamento)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={statusVariant[c.status] ?? "default"}>
                            {statusLabel(c.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {grupos.length === 0 && (
          <p className="p-8 text-center text-slate-500">Nenhuma cobrança.</p>
        )}
      </TableScroll>
    </div>
  );
}
