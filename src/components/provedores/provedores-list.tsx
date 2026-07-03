"use client";

import { useMemo, useState, Fragment, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, ChevronRight, Building2, Plus, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { ProvedorFormDialog } from "@/components/provedores/provedor-form-dialog";
import { formatCpf, formatCurrency, formatPhone, statusLabel } from "@/lib/utils";
import {
  filterSortProvedores,
  filterSortTitularesComDependentes,
  getVisibleDependentes,
  matchesPerson,
} from "@/lib/search";
import type { Beneficiario, Provedor } from "@/types/database";

const statusVariant: Record<string, "success" | "warning" | "danger" | "default"> = {
  ativo: "success",
  elegivel: "warning",
  inativo: "danger",
};

export function ProvedoresList({
  provedores,
}: {
  provedores: (Provedor & {
    titulares: (Beneficiario & { dependentes: Beneficiario[] })[];
    totalBeneficiarios: number;
    totalTitulares: number;
    totalDependentes: number;
  })[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTitulares, setExpandedTitulares] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvedor, setSelectedProvedor] = useState<Provedor>();

  const filtered = useMemo(
    () => filterSortProvedores(provedores, search),
    [provedores, search]
  );

  useEffect(() => {
    const q = search.trim();
    if (!q) return;

    const provedorIds = provedores
      .filter(
        (p) =>
          p.nome.toLowerCase().includes(q.toLowerCase()) ||
          p.titulares.some(
            (t) =>
              matchesPerson(t, q) ||
              t.dependentes.some((d) => matchesPerson(d, q))
          )
      )
      .map((p) => p.id);

    const titularIds = provedores.flatMap((p) =>
      p.titulares
        .filter(
          (t) =>
            matchesPerson(t, q) ||
            t.dependentes.some((d) => matchesPerson(d, q))
        )
        .map((t) => t.id)
    );

    if (provedorIds.length) {
      setExpanded((prev) => new Set([...prev, ...provedorIds]));
    }
    if (titularIds.length) {
      setExpandedTitulares((prev) => new Set([...prev, ...titularIds]));
    }
  }, [search, provedores]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTitular(id: string) {
    setExpandedTitulares((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate() {
    setSelectedProvedor(undefined);
    setDialogOpen(true);
  }

  function openEdit(provedor: Provedor) {
    setSelectedProvedor(provedor);
    setDialogOpen(true);
  }

  function handleSuccess() {
    router.refresh();
  }

  const incompletos = provedores.filter((p) => !p.cadastro_completo).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Pesquisar empresa, nome, CPF ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo provedor
        </Button>
      </div>

      {incompletos > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {incompletos} provedor(es) com cadastro incompleto. Complete benefício, custo,
          valor do cliente, mensagem padrão e dia de pagamento.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm text-slate-500">Empresas</p>
          <p className="text-2xl font-semibold">{provedores.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm text-slate-500">Titulares vinculados</p>
          <p className="text-2xl font-semibold">
            {provedores.reduce((acc, p) => acc + p.totalTitulares, 0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm text-slate-500">Dependentes vinculados</p>
          <p className="text-2xl font-semibold">
            {provedores.reduce((acc, p) => acc + p.totalDependentes, 0)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((provedor) => {
          const visibleTitulares = search.trim()
            ? filterSortTitularesComDependentes(provedor.titulares, search)
            : provedor.titulares;

          return (
          <div
            key={provedor.id}
            className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 dark:bg-slate-900">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => toggleExpand(provedor.id)}
              >
                {expanded.has(provedor.id) ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <Building2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{provedor.nome}</p>
                  <p className="text-xs text-slate-500">
                    {provedor.totalTitulares} titular(es) · {provedor.totalDependentes}{" "}
                    dependente(s)
                    {provedor.beneficio ? ` · ${provedor.beneficio}` : ""}
                    {provedor.custo_colaborador != null
                      ? ` · ${formatCurrency(Number(provedor.custo_colaborador))}/colab.`
                      : ""}
                    {provedor.dia_pagamento
                      ? ` · Paga dia ${provedor.dia_pagamento}`
                      : ""}
                    {provedor.valor_cobrado_mensal != null
                      ? ` · Cobrança ${formatCurrency(Number(provedor.valor_cobrado_mensal))}/mês`
                      : ""}
                  </p>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {!provedor.cadastro_completo && (
                  <Badge variant="warning">Cadastro incompleto</Badge>
                )}
                <Badge variant="info">{provedor.totalBeneficiarios} funcionários</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Editar provedor"
                  onClick={() => openEdit(provedor)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {expanded.has(provedor.id) ||
            (search.trim() && visibleTitulares.length > 0) ? (
              <TableScroll>
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-white dark:bg-slate-950">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Nome</th>
                      <th className="hidden px-4 py-3 text-left font-medium md:table-cell">
                        CPF
                      </th>
                      <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                        Telefone
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                        Plano
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {provedor.titulares.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                          Nenhum funcionário vinculado a esta empresa.
                        </td>
                      </tr>
                    ) : (
                      visibleTitulares.map((t) => {
                        const visibleDependentes = getVisibleDependentes(t, search);
                        const showDependentes =
                          expandedTitulares.has(t.id) ||
                          (search.trim() && visibleDependentes.length > 0);

                        return (
                        <Fragment key={t.id}>
                          <tr className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                className="flex items-center gap-2 font-medium"
                                onClick={() =>
                                  t.dependentes.length && toggleTitular(t.id)
                                }
                              >
                                {t.dependentes.length > 0 ? (
                                  expandedTitulares.has(t.id) ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )
                                ) : (
                                  <span className="w-4" />
                                )}
                                {t.nome}
                                <Badge variant="info">{statusLabel("titular")}</Badge>
                              </button>
                            </td>
                            <td className="hidden px-4 py-3 md:table-cell">
                              {formatCpf(t.cpf)}
                            </td>
                            <td className="hidden px-4 py-3 lg:table-cell">
                              {formatPhone(t.telefone)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={statusVariant[t.status_totalpass]}>
                                {statusLabel(t.status_totalpass)}
                              </Badge>
                            </td>
                            <td className="hidden px-4 py-3 lg:table-cell">
                              {t.plano ?? "-"}
                            </td>
                          </tr>
                          {showDependentes &&
                            visibleDependentes.map((d) => (
                              <tr
                                key={d.id}
                                className="bg-slate-50/50 dark:bg-slate-900/50"
                              >
                                <td className="px-4 py-2 pl-12 text-slate-600 dark:text-slate-400">
                                  {d.nome}
                                  <Badge className="ml-2" variant="default">
                                    {statusLabel("dependente")}
                                  </Badge>
                                </td>
                                <td className="hidden px-4 py-2 md:table-cell">
                                  {formatCpf(d.cpf)}
                                </td>
                                <td className="hidden px-4 py-2 lg:table-cell">
                                  {formatPhone(d.telefone)}
                                </td>
                                <td className="px-4 py-2">
                                  <Badge variant={statusVariant[d.status_totalpass]}>
                                    {statusLabel(d.status_totalpass)}
                                  </Badge>
                                </td>
                                <td className="hidden px-4 py-2 lg:table-cell">
                                  {d.plano ?? "-"}
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
            ) : null}
          </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
            Nenhuma empresa encontrada. Importe a planilha do TotalPass para vincular os
            funcionários às empresas.
          </p>
        )}
      </div>

      <ProvedorFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provedor={selectedProvedor}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
