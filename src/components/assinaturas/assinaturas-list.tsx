"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nextDueDateFromDay } from "@/lib/asaas/client";
import {
  formatCurrency,
  formatDate,
  formatIsoToBrDate,
  isValidDateInput,
  maskCurrencyInput,
  maskDateInput,
  parseCurrencyInput,
  parseDateInput,
  statusLabel,
} from "@/lib/utils";
import type { Assinatura, Beneficiario } from "@/types/database";

type AssinaturaComBeneficiario = Assinatura & {
  beneficiario: Beneficiario | Beneficiario[] | null;
};

type GrupoAssinaturas = {
  id: string;
  beneficiario: Beneficiario | null;
  assinaturas: AssinaturaComBeneficiario[];
  ativas: number;
  canceladas: number;
};

function getBeneficiario(a: AssinaturaComBeneficiario) {
  return Array.isArray(a.beneficiario) ? a.beneficiario[0] ?? null : a.beneficiario;
}

function statusResumoAssinaturas(grupo: GrupoAssinaturas) {
  const parts = [
    grupo.ativas > 0 ? `${grupo.ativas} ativa(s)` : null,
    grupo.canceladas > 0 ? `${grupo.canceladas} cancelada(s)` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "Sem assinaturas";
}

function assinaturaPrincipal(grupo: GrupoAssinaturas) {
  return grupo.assinaturas.find((a) => a.status === "ACTIVE") ?? grupo.assinaturas[0];
}

function vencimentoExibicao(a: Assinatura) {
  if (a.proximo_vencimento) return formatDate(a.proximo_vencimento);
  return formatIsoToBrDate(nextDueDateFromDay(a.dia_vencimento));
}

function vencimentoParaEdicao(a: Assinatura) {
  if (a.proximo_vencimento) return formatIsoToBrDate(a.proximo_vencimento);
  return formatIsoToBrDate(nextDueDateFromDay(a.dia_vencimento));
}

type AssinaturasPagination = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

type AssinaturasFiltros = {
  q: string;
};

function buildAssinaturasUrl(page: number, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/assinaturas${qs ? `?${qs}` : ""}`;
}

export function AssinaturasList({
  assinaturas,
  beneficiarioOrdem,
  pagination,
  filtros,
}: {
  assinaturas: AssinaturaComBeneficiario[];
  beneficiarioOrdem: string[];
  pagination: AssinaturasPagination;
  filtros: AssinaturasFiltros;
}) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [loading, setLoading] = useState(false);
  const [buscaDraft, setBuscaDraft] = useState(filtros.q);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setBuscaDraft(filtros.q);
  }, [filtros.q]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function aplicarBusca() {
    router.push(buildAssinaturasUrl(1, buscaDraft.trim()));
  }

  function limparBusca() {
    setBuscaDraft("");
    router.push("/assinaturas");
  }

  function irParaPagina(page: number) {
    router.push(buildAssinaturasUrl(page, filtros.q));
  }

  const grupos = useMemo(() => {
    const map = new Map<string, GrupoAssinaturas>();

    for (const assinatura of assinaturas) {
      const beneficiario = getBeneficiario(assinatura);
      const id = beneficiario?.id ?? assinatura.beneficiario_id ?? assinatura.id;
      const grupo =
        map.get(id) ??
        ({
          id,
          beneficiario,
          assinaturas: [],
          ativas: 0,
          canceladas: 0,
        } satisfies GrupoAssinaturas);

      grupo.assinaturas.push(assinatura);
      if (assinatura.status === "ACTIVE") grupo.ativas++;
      if (assinatura.status === "CANCELLED") grupo.canceladas++;

      map.set(id, grupo);
    }

    const ordem = beneficiarioOrdem.length
      ? beneficiarioOrdem
      : [...map.keys()];

    return ordem
      .map((id) => map.get(id))
      .filter((grupo): grupo is GrupoAssinaturas => grupo !== undefined);
  }, [assinaturas, beneficiarioOrdem]);

  useEffect(() => {
    if (!filtros.q) return;
    setExpanded(new Set(grupos.map((grupo) => grupo.id)));
  }, [filtros.q, grupos]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAction(id: string, action: string, extra?: object) {
    setLoading(true);
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Assinatura atualizada");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
      setEditId(null);
    }
  }

  function getNomeGrupo(grupo: GrupoAssinaturas) {
    return grupo.beneficiario?.nome ?? "-";
  }

  function openEdit(a: AssinaturaComBeneficiario) {
    setEditId(a.id);
    setValor(maskCurrencyInput(String(Math.round(Number(a.valor) * 100))));
    setVencimento(vencimentoParaEdicao(a));
  }

  function handleSave() {
    if (!editId) return;

    const valorNum = parseCurrencyInput(valor);
    if (valorNum <= 0) {
      toast.error("Informe um valor válido");
      return;
    }

    if (!isValidDateInput(vencimento)) {
      toast.error("Informe a data de vencimento no formato dd/mm/aaaa");
      return;
    }

    const nextDueDate = parseDateInput(vencimento);
    if (!nextDueDate) {
      toast.error("Data de vencimento inválida");
      return;
    }

    handleAction(editId, "update", {
      valor: valorNum,
      nextDueDate,
    });
  }

  return (
    <>
      <div className="mb-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-slate-500">
              Pesquisar por nome, CPF ou telefone
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Nome, CPF ou telefone..."
                  value={buscaDraft}
                  onChange={(e) => setBuscaDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      aplicarBusca();
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={aplicarBusca}>
                Buscar
              </Button>
              {filtros.q && (
                <Button type="button" variant="outline" size="sm" onClick={limparBusca}>
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {pagination.total === 0
            ? filtros.q
              ? "Nenhum cliente encontrado para a busca"
              : "Nenhum cliente com assinatura"
            : `Exibindo ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                pagination.page * pagination.pageSize,
                pagination.total
              )} de ${pagination.total} cliente(s)`}
        </p>
      </div>

      <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Cliente</th>
              <th className="px-4 py-3 text-left font-medium">Valor</th>
              <th className="px-4 py-3 text-left font-medium">Vencimento</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Criação</th>
              <th className="px-4 py-3 text-left font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {grupos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {filtros.q
                    ? "Nenhum cliente encontrado com os filtros aplicados."
                    : "Nenhum cliente nesta página."}
                </td>
              </tr>
            ) : (
              grupos.map((grupo) => {
                const aberto = expanded.has(grupo.id);
                const principal = assinaturaPrincipal(grupo);
                const destaque =
                  grupo.ativas > 0
                    ? "ACTIVE"
                    : grupo.canceladas > 0
                      ? "CANCELLED"
                      : principal?.status ?? "default";
                const multiplas = grupo.assinaturas.length > 1;

                return (
                  <Fragment key={grupo.id}>
                    <tr className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
                      <td className="px-4 py-3">
                        {multiplas ? (
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left font-medium"
                            onClick={() => toggleExpand(grupo.id)}
                          >
                            {aberto ? (
                              <ChevronDown className="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" />
                            )}
                            <span>{getNomeGrupo(grupo)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {grupo.assinaturas.length} assinatura(s)
                            </span>
                          </button>
                        ) : (
                          <span className="font-medium">{getNomeGrupo(grupo)}</span>
                        )}
                        {multiplas && (
                          <p className="mt-1 pl-6 text-xs text-slate-500">
                            {statusResumoAssinaturas(grupo)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {principal ? formatCurrency(Number(principal.valor)) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {principal ? vencimentoExibicao(principal) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            destaque === "ACTIVE"
                              ? "success"
                              : destaque === "CANCELLED"
                                ? "danger"
                                : "default"
                          }
                        >
                          {statusLabel(destaque)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {principal ? formatDate(principal.data_criacao) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {principal && !multiplas && (
                          <div className="flex flex-wrap gap-2">
                            {principal.status === "ACTIVE" ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={loading}
                                onClick={() => handleAction(principal.id, "cancel")}
                              >
                                Cancelar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={loading}
                                onClick={() => handleAction(principal.id, "reactivate")}
                              >
                                Reativar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(principal)}
                            >
                              Editar
                            </Button>
                          </div>
                        )}
                        {multiplas && !aberto && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleExpand(grupo.id)}
                          >
                            Ver detalhes
                          </Button>
                        )}
                      </td>
                    </tr>

                    {aberto &&
                      grupo.assinaturas.map((a) => (
                        <tr
                          key={a.id}
                          className="bg-slate-50/60 dark:bg-slate-900/50"
                        >
                          <td className="px-4 py-2 pl-10 text-slate-600 dark:text-slate-400">
                            Assinatura
                          </td>
                          <td className="px-4 py-2">{formatCurrency(Number(a.valor))}</td>
                          <td className="px-4 py-2">{vencimentoExibicao(a)}</td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={
                                a.status === "ACTIVE"
                                  ? "success"
                                  : a.status === "CANCELLED"
                                    ? "danger"
                                    : "default"
                              }
                            >
                              {statusLabel(a.status)}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">{formatDate(a.data_criacao)}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-2">
                              {a.status === "ACTIVE" ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={loading}
                                  onClick={() => handleAction(a.id, "cancel")}
                                >
                                  Cancelar
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={loading}
                                  onClick={() => handleAction(a.id, "reactivate")}
                                >
                                  Reativar
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEdit(a)}
                              >
                                Editar
                              </Button>
                            </div>
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

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            Página {pagination.page} de {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => irParaPagina(pagination.page - 1)}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => irParaPagina(pagination.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={() => setEditId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar assinatura</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Valor</label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(maskCurrencyInput(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Data de vencimento
              </label>
              <Input
                inputMode="numeric"
                placeholder="dd/mm/aaaa"
                value={vencimento}
                onChange={(e) => setVencimento(maskDateInput(e.target.value))}
              />
            </div>
            <Button className="w-full" disabled={loading} onClick={handleSave}>
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
