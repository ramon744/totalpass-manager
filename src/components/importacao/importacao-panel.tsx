"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatDateTime, maskCpfInput, maskPhoneInput } from "@/lib/utils";
import { isValidCpf } from "@/lib/validators/cpf";
import type { Importacao } from "@/types/database";
import type {
  DependenteCobrancaPreview,
  ImportPreviewRow,
} from "@/lib/services/import";

interface ProvedorOption {
  id: string;
  nome: string;
}

interface PreviewState {
  file: File;
  colaboradores: ImportPreviewRow[];
}

interface PendingImport {
  file: File;
  provedorId?: string;
  rows?: ImportPreviewRow[];
}

type ImportacaoPagination = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

function buildImportacaoUrl(page: number) {
  if (page <= 1) return "/importacao";
  return `/importacao?page=${page}`;
}

export function ImportacaoPanel({
  historico,
  provedores,
  pagination,
}: {
  historico: Importacao[];
  provedores: ProvedorOption[];
  pagination: ImportacaoPagination;
}) {
  const router = useRouter();

  function irParaPagina(page: number) {
    router.push(buildImportacaoUrl(page));
  }
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [provedorId, setProvedorId] = useState("");
  const [cobrancaDialog, setCobrancaDialog] = useState<{
    dependentes: DependenteCobrancaPreview[];
    pending: PendingImport;
  } | null>(null);
  const [selectedCobrancaCpfs, setSelectedCobrancaCpfs] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<{
    total_processados: number;
    total_criados: number;
    total_atualizados: number;
    total_inativados: number;
    total_erros: number;
    erros: Array<{ linha?: number; mensagem: string }>;
    provedores_incompletos?: string[];
    dependentes_fora_cobranca?: Array<{
      id: string;
      nome: string;
      status: string;
      titular_nome?: string;
    }>;
  } | null>(null);

  async function runImport(
    file: File,
    provedorIdSelecionado?: string,
    rows?: ImportPreviewRow[],
    dependentesCobrancaCpfAprovados?: string[]
  ) {
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    if (provedorIdSelecionado) {
      formData.append("provedorId", provedorIdSelecionado);
    }
    if (rows?.length) {
      formData.append(
        "rows",
        JSON.stringify(
          rows.map((r) => ({
            nome: r.nome.trim(),
            cpf: r.cpf.replace(/\D/g, ""),
            email: r.email.trim(),
            telefone: r.telefone.replace(/\D/g, ""),
            status: r.status.trim(),
          }))
        )
      );
    }
    if (dependentesCobrancaCpfAprovados?.length) {
      formData.append(
        "dependentesCobrancaCpfAprovados",
        JSON.stringify(dependentesCobrancaCpfAprovados.map((cpf) => cpf.replace(/\D/g, "")))
      );
    }

    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResultado(data);
      toast.success("Importação concluída!");
      if (data.provedores_incompletos?.length) {
        toast.warning(
          `${data.provedores_incompletos.length} provedor(es) criado(s) pela planilha precisam ter o cadastro completado em Provedores.`,
          { duration: 8000 }
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na importação");
    } finally {
      setLoading(false);
    }
  }

  async function fetchDependentesNovos(
    file: File,
    provedorIdArg?: string,
    rows?: ImportPreviewRow[]
  ): Promise<DependenteCobrancaPreview[]> {
    const formData = new FormData();
    formData.append("file", file);
    if (provedorIdArg) formData.append("provedorId", provedorIdArg);
    if (rows?.length) {
      formData.append(
        "rows",
        JSON.stringify(
          rows.map((r) => ({
            nome: r.nome.trim(),
            cpf: r.cpf.replace(/\D/g, ""),
            email: r.email.trim(),
            telefone: r.telefone.replace(/\D/g, ""),
            status: r.status.trim(),
          }))
        )
      );
    }
    const res = await fetch("/api/import/preview", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Erro ao analisar dependentes");
    return (data.dependentesNovosCobraveis ?? []) as DependenteCobrancaPreview[];
  }

  async function iniciarImportacao(pending: PendingImport) {
    setLoading(true);
    try {
      const dependentes = await fetchDependentesNovos(
        pending.file,
        pending.provedorId,
        pending.rows
      );
      if (dependentes.length === 0) {
        await runImport(pending.file, pending.provedorId, pending.rows, []);
        return;
      }
      setSelectedCobrancaCpfs(
        new Set(dependentes.map((d) => d.cpf.replace(/\D/g, "")))
      );
      setCobrancaDialog({ dependentes, pending });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao preparar importação");
    } finally {
      setLoading(false);
    }
  }

  function toggleDependenteCobrancaImport(
    cpf: string,
    checked: boolean,
    cobrancaAutomatica?: boolean
  ) {
    if (cobrancaAutomatica) return;
    const normalized = cpf.replace(/\D/g, "");
    setSelectedCobrancaCpfs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(normalized);
      else next.delete(normalized);
      return next;
    });
  }

  async function confirmarCobrancaImport() {
    if (!cobrancaDialog) return;
    const { pending, dependentes } = cobrancaDialog;
    const cpfs = new Set(selectedCobrancaCpfs);
    for (const d of dependentes) {
      if (d.cobranca_automatica) cpfs.add(d.cpf.replace(/\D/g, ""));
    }
    setCobrancaDialog(null);
    await runImport(pending.file, pending.provedorId, pending.rows, Array.from(cpfs));
  }

  function cancelarCobrancaImport() {
    setCobrancaDialog(null);
    toast.info("Importação cancelada. Nenhum dado foi alterado.");
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.requiresProvedor) {
        const colaboradores: ImportPreviewRow[] = (data.preview ?? []).map(
          (r: ImportPreviewRow) => ({
            nome: r.nome ?? "",
            cpf: maskCpfInput(r.cpf ?? ""),
            email: r.email ?? "",
            telefone: r.telefone ? maskPhoneInput(r.telefone) : "",
            status: r.status ?? "active",
          })
        );
        setPreview({ file, colaboradores });
        setProvedorId("");
      } else {
        await iniciarImportacao({ file });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao analisar planilha");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  function updateColaborador(
    index: number,
    campo: keyof ImportPreviewRow,
    value: string
  ) {
    if (!preview) return;
    setPreview({
      ...preview,
      colaboradores: preview.colaboradores.map((c, i) => {
        if (i !== index) return c;
        if (campo === "cpf") return { ...c, cpf: maskCpfInput(value) };
        if (campo === "telefone") return { ...c, telefone: maskPhoneInput(value) };
        return { ...c, [campo]: value };
      }),
    });
  }

  async function confirmarComProvedor() {
    if (!preview) return;
    if (!provedorId) {
      toast.error("Selecione um provedor para vincular os colaboradores");
      return;
    }
    if (preview.colaboradores.some((c) => !c.nome.trim())) {
      toast.error("Todos os colaboradores precisam de nome");
      return;
    }
    if (
      preview.colaboradores.some((c) => {
        const cpf = c.cpf.replace(/\D/g, "");
        return !cpf || !isValidCpf(cpf);
      })
    ) {
      toast.error("Verifique o CPF de todos os colaboradores");
      return;
    }

    const file = preview.file;
    const rows = preview.colaboradores;
    setPreview(null);
    await iniciarImportacao({ file, provedorId, rows });
    setProvedorId("");
  }

  function cancelarVinculo() {
    setPreview(null);
    setProvedorId("");
    toast.info("Importação cancelada. Nenhum colaborador foi adicionado.");
  }

  async function voltarCobrarDependente(id: string) {
    try {
      const res = await fetch("/api/dependentes-cobranca", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependenteId: id, cobrar: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao reativar cobrança");

      setResultado((prev) =>
        prev
          ? {
              ...prev,
              dependentes_fora_cobranca:
                prev.dependentes_fora_cobranca?.filter((d) => d.id !== id) ?? [],
            }
          : prev
      );
      toast.success("Dependente voltou para a cobrança");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reativar cobrança");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload de planilha</CardTitle>
          <CardDescription>
            Importe a planilha oficial do TotalPass (.xlsx) ou a planilha de colaboradores
            (.csv). Planilhas sem coluna de empresa exigem vincular um provedor antes de
            importar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-12 transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-slate-700 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/20">
            <Upload className="mb-4 h-10 w-10 text-slate-400" />
            <p className="mb-2 text-sm font-medium">
              {loading ? "Processando..." : "Clique para selecionar arquivo"}
            </p>
            <p className="text-xs text-slate-500">.xlsx, .xls, .csv</p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleUpload}
              disabled={loading}
            />
          </label>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(open) => !open && cancelarVinculo()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Vincular provedor</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                A planilha <strong>{preview.file.name}</strong> não possui coluna de empresa.
                Revise os {preview.colaboradores.length} colaborador(es) abaixo, edite se
                necessário e selecione o provedor para vincular.
              </p>

              <div>
                <label className="mb-1 block text-sm font-medium">Provedor *</label>
                <select
                  className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  value={provedorId}
                  onChange={(e) => setProvedorId(e.target.value)}
                >
                  <option value="">Selecione um provedor</option>
                  {provedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
                {provedores.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600">
                    Nenhum provedor cadastrado. Cadastre um provedor antes de importar.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">
                  Colaboradores ({preview.colaboradores.length})
                </p>
                <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs dark:bg-slate-900">
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Nome</th>
                        <th className="px-3 py-2 text-left font-medium">CPF</th>
                        <th className="px-3 py-2 text-left font-medium">Email</th>
                        <th className="px-3 py-2 text-left font-medium">Telefone</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {preview.colaboradores.map((c, idx) => (
                        <tr key={idx} className="bg-white dark:bg-slate-950">
                          <td className="px-3 py-2 text-xs text-slate-500">{idx + 1}</td>
                          <td className="px-2 py-2">
                            <Input
                              className="h-8 text-xs"
                              value={c.nome}
                              onChange={(e) =>
                                updateColaborador(idx, "nome", e.target.value)
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="h-8 text-xs"
                              value={c.cpf}
                              onChange={(e) =>
                                updateColaborador(idx, "cpf", e.target.value)
                              }
                              inputMode="numeric"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="h-8 text-xs"
                              type="email"
                              value={c.email}
                              onChange={(e) =>
                                updateColaborador(idx, "email", e.target.value)
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="h-8 text-xs"
                              value={c.telefone}
                              onChange={(e) =>
                                updateColaborador(idx, "telefone", e.target.value)
                              }
                              placeholder="(00) 00000-0000"
                              inputMode="numeric"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              className="flex h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                              value={c.status}
                              onChange={(e) =>
                                updateColaborador(idx, "status", e.target.value)
                              }
                            >
                              <option value="active">Ativo</option>
                              <option value="inactive">Inativo</option>
                              <option value="elegivel">Elegível</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Você pode corrigir nome, CPF, email, telefone e status antes de importar.
                  Telefone pode ficar em branco — será obrigatório apenas na criação da
                  assinatura.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancelarVinculo}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={confirmarComProvedor}
                  disabled={!provedorId || loading}
                >
                  Importar {preview.colaboradores.length} colaborador(es)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!cobrancaDialog}
        onOpenChange={(open) => !open && cancelarCobrancaImport()}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cobrança de dependentes na importação</DialogTitle>
          </DialogHeader>
          {cobrancaDialog && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Foram encontrados{" "}
                <strong>{cobrancaDialog.dependentes.length}</strong> dependente(s){" "}
                <strong>novo(s)</strong> elegíveis para cobrança. Marque quais devem
                entrar na fatura. Dependentes de titulares que já cobram outro
                dependente entram automaticamente.
              </p>

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedCobrancaCpfs(
                      new Set(
                        cobrancaDialog.dependentes.map((d) => d.cpf.replace(/\D/g, ""))
                      )
                    )
                  }
                >
                  Marcar todos
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedCobrancaCpfs(
                      new Set(
                        cobrancaDialog.dependentes
                          .filter((d) => d.cobranca_automatica)
                          .map((d) => d.cpf.replace(/\D/g, ""))
                      )
                    )
                  }
                >
                  Desmarcar opcionais
                </Button>
              </div>

              <div className="max-h-[45vh] space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {cobrancaDialog.dependentes.map((d) => {
                  const cpfNorm = d.cpf.replace(/\D/g, "");
                  const checked = d.cobranca_automatica || selectedCobrancaCpfs.has(cpfNorm);
                  return (
                    <label
                      key={cpfNorm}
                      className={`flex items-start gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900 ${
                        d.cobranca_automatica ? "ring-1 ring-emerald-300 dark:ring-emerald-800" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={d.cobranca_automatica}
                        onChange={(e) =>
                          toggleDependenteCobrancaImport(
                            d.cpf,
                            e.target.checked,
                            d.cobranca_automatica
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {d.nome}
                          {d.cobranca_automatica && (
                            <span className="ml-2 text-xs font-normal text-emerald-700 dark:text-emerald-300">
                              (cobrança automática)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          CPF: {maskCpfInput(d.cpf)} · Titular: {d.titular_nome} (
                          {maskCpfInput(d.titular_cpf)}) · {d.provedor_nome}
                        </p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-300">
                          + {formatCurrency(d.valor_dependente)} / mês
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500">
                {(() => {
                  const total = new Set([
                    ...selectedCobrancaCpfs,
                    ...cobrancaDialog.dependentes
                      .filter((d) => d.cobranca_automatica)
                      .map((d) => d.cpf.replace(/\D/g, "")),
                  ]).size;
                  return `${total} de ${cobrancaDialog.dependentes.length} selecionado(s) para cobrança.`;
                })()}
              </p>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancelarCobrancaImport}>
                  Cancelar importação
                </Button>
                <Button
                  type="button"
                  onClick={confirmarCobrancaImport}
                  disabled={loading}
                >
                  {(() => {
                    const total = new Set([
                      ...selectedCobrancaCpfs,
                      ...cobrancaDialog.dependentes
                        .filter((d) => d.cobranca_automatica)
                        .map((d) => d.cpf.replace(/\D/g, "")),
                    ]).size;
                    return total > 0
                      ? `Importar e cobrar ${total} dependente(s)`
                      : "Importar sem cobrar dependentes";
                  })()}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {resultado && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado da importação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-5">
            <Stat label="Processados" value={resultado.total_processados} />
            <Stat label="Criados" value={resultado.total_criados} />
            <Stat label="Atualizados" value={resultado.total_atualizados} />
            <Stat label="Inativados" value={resultado.total_inativados} />
            <Stat label="Erros" value={resultado.total_erros} />
          </CardContent>
          {resultado.provedores_incompletos &&
            resultado.provedores_incompletos.length > 0 && (
              <CardContent className="border-t border-amber-200 pt-4 dark:border-amber-900">
                <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                  Provedores com cadastro incompleto
                </p>
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                  Estas empresas foram criadas automaticamente pela planilha (apenas com o
                  nome). Acesse a aba Provedores para informar benefício, custo por
                  colaborador e dia de pagamento da fatura.
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-amber-800 dark:text-amber-200">
                  {resultado.provedores_incompletos.map((nome) => (
                    <li key={nome}>{nome}</li>
                  ))}
                </ul>
              </CardContent>
            )}
          {resultado.dependentes_fora_cobranca &&
            resultado.dependentes_fora_cobranca.length > 0 && (
              <CardContent className="border-t border-amber-200 pt-4 dark:border-amber-900">
                <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                  Dependentes ativos/elegíveis fora da cobrança
                </p>
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                  Eles continuam na planilha, mas foram desativados manualmente para
                  cobrança. Você pode manter assim ou voltar a cobrar agora.
                </p>
                <div className="space-y-2">
                  {resultado.dependentes_fora_cobranca.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-amber-900 dark:text-amber-100">
                          {d.nome}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Titular: {d.titular_nome ?? "-"} · Status: {d.status}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => voltarCobrarDependente(d.id)}
                      >
                        Voltar a cobrar
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de importações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            {pagination.total === 0
              ? "Nenhuma importação realizada"
              : `Exibindo ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                )} de ${pagination.total} importação(ões)`}
          </p>
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="pb-3 text-left font-medium">Arquivo</th>
                  <th className="pb-3 text-left font-medium">Data</th>
                  <th className="pb-3 text-left font-medium">Processados</th>
                  <th className="pb-3 text-left font-medium">Criados</th>
                  <th className="pb-3 text-left font-medium">Atualizados</th>
                  <th className="pb-3 text-left font-medium">Inativados</th>
                  <th className="pb-3 text-left font-medium">Erros</th>
                  <th className="pb-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {historico.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Nenhuma importação nesta página.
                    </td>
                  </tr>
                ) : (
                  historico.map((h) => (
                    <tr key={h.id}>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                          {h.arquivo_nome}
                        </div>
                      </td>
                      <td className="py-3">{formatDateTime(h.created_at)}</td>
                      <td className="py-3">{h.total_processados}</td>
                      <td className="py-3">{h.total_criados}</td>
                      <td className="py-3">{h.total_atualizados}</td>
                      <td className="py-3">{h.total_inativados}</td>
                      <td className="py-3">{h.total_erros}</td>
                      <td className="py-3 capitalize">{h.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-center dark:bg-slate-800">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
