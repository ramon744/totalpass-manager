"use client";

import { useMemo, useState, Fragment, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronDown, ChevronRight, Plus, UserPlus, Pencil, CreditCard, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BeneficiarioFormDialog,
  type BeneficiarioFormMode,
} from "@/components/beneficiarios/beneficiario-form-dialog";
import { AssinaturaFormDialog } from "@/components/assinaturas/assinatura-form-dialog";
import {
  formatCpf,
  formatPhone,
  statusLabel,
} from "@/lib/utils";
import { BeneficiariosResumoPanel } from "@/components/beneficiarios/beneficiarios-resumo";
import { resumoFromTitulares } from "@/lib/beneficiarios-resumo";
import {
  permiteGestaoCobrancaDependentes,
} from "@/lib/dependent-billing";
import {
  getVisibleDependentes,
  matchesPerson,
  getDependentesByFiltro,
  shouldRenderTitularRow,
  shouldAutoExpandTitular,
  type BeneficiarioFiltro,
  type BeneficiarioPerfilFiltro,
} from "@/lib/search";
import type { Beneficiario, Provedor, BeneficiarioResumo } from "@/types/database";

const statusVariant: Record<string, "success" | "warning" | "danger" | "default"> = {
  ativo: "success",
  elegivel: "warning",
  inativo: "danger",
};

const FILTROS_VALIDOS: BeneficiarioFiltro[] = [
  "todos",
  "ativo",
  "elegivel",
  "inativo",
  "titular",
  "dependente",
];

function parseFiltro(value: string | null): BeneficiarioFiltro {
  if (value && FILTROS_VALIDOS.includes(value as BeneficiarioFiltro)) {
    return value as BeneficiarioFiltro;
  }
  return "todos";
}

function parsePerfil(value: string | null): BeneficiarioPerfilFiltro {
  if (value === "titular" || value === "dependente") return value;
  return null;
}

type BeneficiariosPagination = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

type BeneficiariosFiltros = {
  q: string;
  filtro: BeneficiarioFiltro;
  perfil: BeneficiarioPerfilFiltro;
};

function buildBeneficiariosUrl(
  page: number,
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro,
  q: string
) {
  const params = new URLSearchParams();
  if (filtro !== "todos") params.set("filtro", filtro);
  if (perfil) params.set("perfil", perfil);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/beneficiarios${qs ? `?${qs}` : ""}`;
}

export function BeneficiariosList({
  titulares,
  comAssinatura,
  contagem,
  resumo,
  defaults,
  provedoresById,
  pagination,
  filtros,
}: {
  titulares: (Beneficiario & { dependentes: Beneficiario[] })[];
  comAssinatura: string[];
  contagem: Record<BeneficiarioFiltro, number>;
  resumo: {
    titulares: BeneficiarioResumo;
    dependentes: BeneficiarioResumo;
    totalBeneficiarios: number;
  };
  defaults: { valor: number; dia: number; descricao: string };
  provedoresById: Map<string, Provedor>;
  pagination: BeneficiariosPagination;
  filtros: BeneficiariosFiltros;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const assinaturaIds = useMemo(() => new Set(comAssinatura), [comAssinatura]);
  const [buscaDraft, setBuscaDraft] = useState(filtros.q);
  const [filtro, setFiltro] = useState<BeneficiarioFiltro>(filtros.filtro);
  const [perfilFiltro, setPerfilFiltro] = useState<BeneficiarioPerfilFiltro>(
    filtros.perfil
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<BeneficiarioFormMode>("create_titular");
  const [selectedBeneficiario, setSelectedBeneficiario] = useState<Beneficiario>();
  const [selectedTitularId, setSelectedTitularId] = useState<string>();
  const [selectedTitularNome, setSelectedTitularNome] = useState<string>();
  const [selectedTitularProvedorId, setSelectedTitularProvedorId] = useState<
    string | null
  >();
  const [assinaturaDialogOpen, setAssinaturaDialogOpen] = useState(false);
  const [assinaturaBeneficiario, setAssinaturaBeneficiario] = useState<Beneficiario>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Beneficiario>();
  const [deleteDependentesCount, setDeleteDependentesCount] = useState(0);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [notificarCancelamento, setNotificarCancelamento] = useState(true);
  const [desvinculoOpen, setDesvinculoOpen] = useState(false);
  const [desvinculoTarget, setDesvinculoTarget] = useState<Beneficiario>();
  const [desvinculoConfirmouHr, setDesvinculoConfirmouHr] = useState(false);
  const [desvinculoNotificar, setDesvinculoNotificar] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);

  const filtered = titulares;

  const temResultados = useMemo(() => {
    return filtered.some((t) => {
      const deps = getDependentesByFiltro(t.dependentes, filtro, perfilFiltro);
      const visible = getVisibleDependentes({ ...t, dependentes: deps }, filtros.q);
      return shouldRenderTitularRow(t, filtro, perfilFiltro) || visible.length > 0;
    });
  }, [filtered, filtro, perfilFiltro, filtros.q]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setBuscaDraft(filtros.q);
    setFiltro(filtros.filtro);
    setPerfilFiltro(filtros.perfil);
  }, [filtros.q, filtros.filtro, filtros.perfil]);

  useEffect(() => {
    setFiltro(parseFiltro(searchParams.get("filtro")));
    setPerfilFiltro(parsePerfil(searchParams.get("perfil")));
  }, [searchParams]);

  useEffect(() => {
    if (filtro === "dependente" || perfilFiltro === "dependente") {
      setExpanded(new Set(filtered.map((t) => t.id)));
      return;
    }

    if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
      const ids = filtered
        .filter((t) => shouldAutoExpandTitular(t, filtro, perfilFiltro))
        .map((t) => t.id);
      if (ids.length) {
        setExpanded((prev) => new Set([...prev, ...ids]));
      }
    }
  }, [filtro, perfilFiltro, filtered]);

  useEffect(() => {
    const q = filtros.q.trim();
    if (!q) return;

    const ids = titulares
      .filter(
        (t) =>
          matchesPerson(t, q) ||
          t.dependentes.some((d) => matchesPerson(d, q))
      )
      .map((t) => t.id);

    if (!ids.length) return;
    setExpanded((prev) => new Set([...prev, ...ids]));
  }, [filtros.q, titulares]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectableIds = useMemo(() => {
    const ids: string[] = [];
    for (const t of filtered) {
      const deps = getDependentesByFiltro(t.dependentes, filtro, perfilFiltro);
      const visible = getVisibleDependentes({ ...t, dependentes: deps }, filtros.q);
      if (shouldRenderTitularRow(t, filtro, perfilFiltro)) ids.push(t.id);
      for (const d of visible) ids.push(d.id);
    }
    return ids;
  }, [filtered, filtro, perfilFiltro, filtros.q]);

  const titularMap = useMemo(() => {
    const map = new Map<string, Beneficiario & { dependentes: Beneficiario[] }>();
    for (const t of titulares) map.set(t.id, t);
    return map;
  }, [titulares]);

  const provedores = useMemo(
    () => Array.from(provedoresById.values()).sort((a, b) => a.nome.localeCompare(b.nome)),
    [provedoresById]
  );

  const selectedTitularesCount = useMemo(() => {
    let count = 0;
    for (const id of selected) {
      const t = titularMap.get(id);
      if (t) count++;
    }
    return count;
  }, [selected, titularMap]);

  const dependentesAutoCount = useMemo(() => {
    let count = 0;
    for (const id of selected) {
      const t = titularMap.get(id);
      if (t) count += t.dependentes.length;
    }
    return count;
  }, [selected, titularMap]);

  const selectedComAssinaturaAtiva = useMemo(() => {
    let count = 0;
    for (const id of selected) {
      if (assinaturaIds.has(id)) count++;
    }
    return count;
  }, [selected, assinaturaIds]);

  const deleteTargetTemAssinaturaAtiva = Boolean(
    deleteTarget && assinaturaIds.has(deleteTarget.id)
  );

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const filtrosOpcoes: { id: BeneficiarioFiltro; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "ativo", label: "Ativo" },
    { id: "elegivel", label: "Elegível" },
    { id: "inativo", label: "Inativo" },
    { id: "titular", label: "Titular" },
    { id: "dependente", label: "Dependente" },
  ];

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function aplicarFiltro(novoFiltro: BeneficiarioFiltro) {
    setFiltro(novoFiltro);
    setPerfilFiltro(null);
    router.replace(buildBeneficiariosUrl(1, novoFiltro, null, filtros.q));
  }

  function aplicarBusca() {
    router.replace(
      buildBeneficiariosUrl(1, filtros.filtro, filtros.perfil, buscaDraft.trim())
    );
  }

  function limparBusca() {
    setBuscaDraft("");
    router.replace(buildBeneficiariosUrl(1, filtros.filtro, filtros.perfil, ""));
  }

  function irParaPagina(page: number) {
    router.replace(
      buildBeneficiariosUrl(page, filtros.filtro, filtros.perfil, filtros.q)
    );
  }

  function openCreateTitular() {
    setDialogMode("create_titular");
    setSelectedBeneficiario(undefined);
    setSelectedTitularId(undefined);
    setSelectedTitularNome(undefined);
    setSelectedTitularProvedorId(undefined);
    setDialogOpen(true);
  }

  function openCreateDependente(titular: Beneficiario) {
    setDialogMode("create_dependente");
    setSelectedBeneficiario(undefined);
    setSelectedTitularId(titular.id);
    setSelectedTitularNome(titular.nome);
    setSelectedTitularProvedorId(titular.provedor_id);
    setExpanded((prev) => new Set(prev).add(titular.id));
    setDialogOpen(true);
  }

  function openEdit(beneficiario: Beneficiario) {
    setDialogMode("edit");
    setSelectedBeneficiario(beneficiario);
    setSelectedTitularId(beneficiario.titular_id ?? undefined);
    setSelectedTitularNome(undefined);
    setSelectedTitularProvedorId(undefined);
    setDialogOpen(true);
  }

  function openCreateAssinatura(beneficiario: Beneficiario) {
    setAssinaturaBeneficiario(beneficiario);
    setAssinaturaDialogOpen(true);
  }

  async function toggleDependenteCobranca(dependente: Beneficiario) {
    const cobrar = dependente.cobrar_na_assinatura !== true;
    try {
      const res = await fetch("/api/dependentes-cobranca", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dependenteId: dependente.id,
          cobrar,
          motivo: cobrar ? "Reativado manualmente" : "Desativado manualmente",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar cobrança");
      toast.success(
        cobrar
          ? "Dependente voltou para a cobrança"
          : "Dependente removido da cobrança"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar cobrança");
    }
  }

  function podeCriarAssinatura(beneficiario: Beneficiario) {
    return (
      beneficiario.perfil === "titular" && !assinaturaIds.has(beneficiario.id)
    );
  }

  function podeDesvinculoManual(beneficiario: Beneficiario) {
    if (beneficiario.perfil !== "titular") return false;
    return (
      beneficiario.status_totalpass === "ativo" ||
      beneficiario.status_totalpass === "elegivel" ||
      assinaturaIds.has(beneficiario.id)
    );
  }

  function openDesvinculoManual(beneficiario: Beneficiario) {
    setDesvinculoTarget(beneficiario);
    setDesvinculoConfirmouHr(false);
    setDesvinculoNotificar(assinaturaIds.has(beneficiario.id));
    setDesvinculoOpen(true);
  }

  async function handleDesvinculoManual() {
    if (!desvinculoTarget) return;
    setDesvinculando(true);
    try {
      const res = await fetch(
        `/api/beneficiarios/${desvinculoTarget.id}/desvinculo-manual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmouHr: desvinculoConfirmouHr,
            notificar: desvinculoNotificar,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro no desvínculo manual");
      toast.success(
        `Desvinculado: ${data.assinaturasCanceladas ?? 0} assinatura(s) cancelada(s)`
      );
      setDesvinculoOpen(false);
      setDesvinculoTarget(undefined);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro no desvínculo manual"
      );
    } finally {
      setDesvinculando(false);
    }
  }

  function handleSuccess() {
    router.refresh();
  }

  function openDelete(beneficiario: Beneficiario, dependentesCount = 0) {
    setDeleteTarget(beneficiario);
    setDeleteDependentesCount(dependentesCount);
    setNotificarCancelamento(assinaturaIds.has(beneficiario.id));
    setDeleteDialogOpen(true);
  }

  function openBulkDelete() {
    setNotificarCancelamento(selectedComAssinaturaAtiva > 0);
    setBulkDeleteOpen(true);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectTitular(t: Beneficiario & { dependentes: Beneficiario[] }) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allMarked = next.has(t.id) && t.dependentes.every((d) => next.has(d.id));
      if (allMarked) {
        next.delete(t.id);
        for (const d of t.dependentes) next.delete(d.id);
      } else {
        next.add(t.id);
        for (const d of t.dependentes) next.add(d.id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function isTitularRowSelected(t: Beneficiario & { dependentes: Beneficiario[] }) {
    if (!selected.has(t.id)) return false;
    if (t.dependentes.length === 0) return true;
    return t.dependentes.every((d) => selected.has(d.id));
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/beneficiarios/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          notificarCancelamento:
            selectedComAssinaturaAtiva > 0 ? notificarCancelamento : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao excluir");

      const falhas = data.results?.filter((r: { success: boolean }) => !r.success) ?? [];
      if (data.sucesso) {
        toast.success(`${data.sucesso} beneficiário(s) excluído(s)`);
      }
      falhas.forEach((f: { error: string }) => toast.error(f.error));

      setBulkDeleteOpen(false);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/beneficiarios/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificarCancelamento:
            deleteTargetTemAssinaturaAtiva ? notificarCancelamento : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao excluir");

      toast.success(
        deleteTarget.perfil === "titular" && deleteDependentesCount > 0
          ? `Titular e ${deleteDependentesCount} dependente(s) excluídos`
          : "Beneficiário excluído"
      );
      setDeleteDialogOpen(false);
      setDeleteTarget(undefined);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <BeneficiariosResumoPanel
        titulares={resumo.titulares}
        dependentes={resumo.dependentes}
        totalBeneficiarios={resumo.totalBeneficiarios}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-slate-500">
            Pesquisar por nome, CPF ou telefone
          </label>
          <div className="flex gap-2">
            <div className="relative max-w-sm flex-1">
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
        <Button onClick={openCreateTitular}>
          <Plus className="mr-2 h-4 w-4" />
          Novo titular
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        {pagination.total === 0
          ? filtros.q
            ? "Nenhum titular encontrado para a busca"
            : "Nenhum titular encontrado"
          : `Exibindo ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
              pagination.page * pagination.pageSize,
              pagination.total
            )} de ${pagination.total} titular(es)`}
      </p>

      <div className="flex flex-wrap gap-2">
        {filtrosOpcoes.map((f) => (
          <button
            key={f.id}
            onClick={() => aplicarFiltro(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filtro === f.id
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {f.label} ({contagem[f.id]})
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-800 dark:text-red-200">
            {selected.size} selecionado(s)
            {selectedTitularesCount > 0 && dependentesAutoCount > 0 && (
              <span className="text-red-600 dark:text-red-300">
                {" "}
                (+ {dependentesAutoCount} dependente(s) dos titulares)
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={openBulkDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  title="Selecionar todos"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="hidden px-4 py-3 text-left font-medium md:table-cell">CPF</th>
              <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">Telefone</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">Plano</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((t) => {
              const depsByFiltro = getDependentesByFiltro(
                t.dependentes,
                filtro,
                perfilFiltro
              );
              const visibleDependentes = getVisibleDependentes(
                { ...t, dependentes: depsByFiltro },
                filtros.q
              );
              const showTitular = shouldRenderTitularRow(t, filtro, perfilFiltro);
              const showDependentes =
                visibleDependentes.length > 0 &&
                (filtro === "dependente" ||
                  perfilFiltro === "dependente" ||
                  shouldAutoExpandTitular(t, filtro, perfilFiltro) ||
                  expanded.has(t.id) ||
                  (filtros.q.trim() && visibleDependentes.length > 0));
              const provedorTitular = t.provedor_id
                ? provedoresById.get(t.provedor_id)
                : undefined;
              const permiteCobrarDependentes = permiteGestaoCobrancaDependentes(
                provedorTitular,
                t.dependentes
              );

              if (!showTitular && visibleDependentes.length === 0) return null;

              return (
              <Fragment key={t.id}>
                {showTitular && (
                <tr className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isTitularRowSelected(t)}
                      onChange={() => toggleSelectTitular(t)}
                      title="Selecionar titular e dependentes"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="flex items-center gap-2 font-medium"
                      onClick={() => t.dependentes.length && toggleExpand(t.id)}
                    >
                      {t.dependentes.length > 0 ? (
                        expanded.has(t.id) ? (
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
                  <td className="hidden px-4 py-3 md:table-cell">{formatCpf(t.cpf)}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">{formatPhone(t.telefone)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[t.status_totalpass]}>
                      {statusLabel(t.status_totalpass)}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">{t.plano ?? "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {podeCriarAssinatura(t) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Criar assinatura"
                          onClick={() => openCreateAssinatura(t)}
                        >
                          <CreditCard className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Adicionar dependente"
                        onClick={() => openCreateDependente(t)}
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Editar titular"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {podeDesvinculoManual(t) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Desvínculo manual (Manager + Asaas)"
                          className="text-amber-700 hover:text-amber-800 dark:text-amber-400"
                          onClick={() => openDesvinculoManual(t)}
                        >
                          <Unlink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Excluir titular"
                        className="text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => openDelete(t, t.dependentes.length)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                )}
                {showDependentes &&
                  visibleDependentes.map((d) => (
                    <tr
                      key={d.id}
                      className="bg-slate-50/50 dark:bg-slate-900/50"
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                          disabled={selected.has(t.id)}
                          title={
                            selected.has(t.id)
                              ? "Já incluído na exclusão do titular"
                              : "Selecionar dependente"
                          }
                        />
                      </td>
                      <td className="px-4 py-2 pl-8 text-slate-600 dark:text-slate-400">
                        {d.nome}
                        <Badge className="ml-2" variant="default">
                          {statusLabel("dependente")}
                        </Badge>
                        {permiteCobrarDependentes &&
                          (d.status_totalpass === "ativo" ||
                            d.status_totalpass === "elegivel") && (
                            <Badge
                              className="ml-2"
                              variant={
                                d.cobrar_na_assinatura === true
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {d.cobrar_na_assinatura === true
                                ? "Cobrando"
                                : "Fora da cobrança"}
                            </Badge>
                          )}
                      </td>
                      <td className="hidden px-4 py-2 md:table-cell">{formatCpf(d.cpf)}</td>
                      <td className="hidden px-4 py-2 lg:table-cell">{formatPhone(d.telefone)}</td>
                      <td className="px-4 py-2">
                        <Badge variant={statusVariant[d.status_totalpass]}>
                          {statusLabel(d.status_totalpass)}
                        </Badge>
                      </td>
                      <td className="hidden px-4 py-2 lg:table-cell">{d.plano ?? "-"}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          {permiteCobrarDependentes &&
                            (d.status_totalpass === "ativo" ||
                              d.status_totalpass === "elegivel") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title={
                                  d.cobrar_na_assinatura === true
                                    ? "Remover dependente da cobrança"
                                    : "Voltar a cobrar dependente"
                                }
                                onClick={() => toggleDependenteCobranca(d)}
                              >
                                {d.cobrar_na_assinatura === true
                                  ? "Remover da cobrança"
                                  : "Incluir na cobrança"}
                              </Button>
                            )}
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Editar dependente"
                            onClick={() => openEdit(d)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Excluir dependente"
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                            onClick={() => openDelete(d)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 || !temResultados ? (
          <p className="p-8 text-center text-slate-500">Nenhum beneficiário encontrado.</p>
        ) : null}
      </TableScroll>

      {pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
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

      <BeneficiarioFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        beneficiario={selectedBeneficiario}
        titularId={selectedTitularId}
        titularNome={selectedTitularNome}
        titularProvedorId={selectedTitularProvedorId}
        provedores={provedores}
        onSuccess={handleSuccess}
      />

      <AssinaturaFormDialog
        open={assinaturaDialogOpen}
        onOpenChange={setAssinaturaDialogOpen}
        beneficiario={assinaturaBeneficiario}
        defaults={defaults}
        provedoresById={provedoresById}
        onSuccess={handleSuccess}
      />

      <Dialog open={desvinculoOpen} onOpenChange={setDesvinculoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desvínculo manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Use quando a extensão ou o TotalPass HR não estiverem disponíveis.
              Isto marca <strong>{desvinculoTarget?.nome}</strong> como inativo
              no Manager, cancela jobs da ponte e cancela a assinatura no Asaas.
              O cadastro permanece (não é exclusão).
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              O TotalPass HR não é alterado por aqui. Inative/remova o vínculo
              lá manualmente (ou confirme que já fez) antes de continuar.
            </p>
            <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                className="mt-1"
                checked={desvinculoConfirmouHr}
                onChange={(e) => setDesvinculoConfirmouHr(e.target.checked)}
                disabled={desvinculando}
              />
              <span>
                Confirmo que já tratei (ou vou tratar) este titular no TotalPass
                HR
              </span>
            </label>
            {desvinculoTarget &&
              assinaturaIds.has(desvinculoTarget.id) && (
                <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={desvinculoNotificar}
                    onChange={(e) => setDesvinculoNotificar(e.target.checked)}
                    disabled={desvinculando}
                  />
                  <span>
                    Notificar por WhatsApp sobre o cancelamento da assinatura
                  </span>
                </label>
              )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDesvinculoOpen(false)}
                disabled={desvinculando}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDesvinculoManual}
                disabled={desvinculando || !desvinculoConfirmouHr}
              >
                {desvinculando ? "Desvinculando..." : "Confirmar desvínculo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir beneficiário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Tem certeza que deseja excluir <strong>{deleteTarget?.nome}</strong>?
              {deleteTarget?.perfil === "titular" && deleteTarget.asaas_customer_id && (
                <> O cliente também será removido do Asaas.</>
              )}
              {deleteDependentesCount > 0 && (
                <>
                  {" "}
                  Os <strong>{deleteDependentesCount}</strong> dependente(s) vinculado(s)
                  também serão excluídos.
                </>
              )}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {deleteTargetTemAssinaturaAtiva
                ? "Este beneficiário possui assinatura ativa. Ela será cancelada no Asaas antes da exclusão."
                : "Assinaturas vinculadas a este beneficiário serão canceladas no Asaas antes da exclusão, se houver."}
              {" "}Esta ação não pode ser desfeita.
            </p>
            {deleteTargetTemAssinaturaAtiva && (
              <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificarCancelamento}
                  onChange={(e) => setNotificarCancelamento(e.target.checked)}
                  disabled={deleting}
                />
                <span>
                  Notificar o beneficiário por WhatsApp sobre o cancelamento da assinatura
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Excluindo..." : "Excluir"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir beneficiários selecionados</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Tem certeza que deseja excluir <strong>{selected.size}</strong>{" "}
              beneficiário(s) selecionado(s)?
              {selectedTitularesCount > 0 && (
                <>
                  {" "}
                  Inclui <strong>{selectedTitularesCount}</strong> titular(es)
                  {dependentesAutoCount > 0 && (
                    <>
                      {" "}
                      e seus <strong>{dependentesAutoCount}</strong> dependente(s)
                    </>
                  )}
                  . Clientes com cadastro no Asaas também serão removidos de lá.
                </>
              )}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {selectedComAssinaturaAtiva > 0
                ? `${selectedComAssinaturaAtiva} beneficiário(s) selecionado(s) possui(em) assinatura ativa. As assinaturas serão canceladas no Asaas antes da exclusão.`
                : "Assinaturas vinculadas aos beneficiários selecionados serão canceladas no Asaas antes da exclusão, se houver."}
              {" "}Esta ação não pode ser desfeita.
            </p>
            {selectedComAssinaturaAtiva > 0 && (
              <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={notificarCancelamento}
                  onChange={(e) => setNotificarCancelamento(e.target.checked)}
                  disabled={deleting}
                />
                <span>
                  Notificar por WhatsApp os beneficiários com assinatura ativa sobre o
                  cancelamento
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {deleting ? "Excluindo..." : `Excluir ${selected.size} selecionado(s)`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
