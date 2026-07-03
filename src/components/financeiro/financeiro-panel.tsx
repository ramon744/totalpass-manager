"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
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
  formatIsoToBrDate,
  formatPhone,
  isValidDateInput,
  maskCpfInput,
  maskCurrencyInput,
  maskDateInput,
  maskPhoneInput,
  normalizeCpf,
  parseCurrencyInput,
  parseDateInput,
} from "@/lib/utils";
import { filterSortTitularesComDependentes, matchesPerson, scorePerson } from "@/lib/search";
import {
  buildPreCadastrosByCpf,
  criarSugestaoWhatsapp,
  type SugestaoWhatsapp,
} from "@/lib/pre-cadastro-match";
import { resolveAssinaturaDefaults } from "@/lib/assinatura-defaults";
import { isValidPhone } from "@/lib/validators/phone";
import type { Beneficiario, PreCadastroWhatsapp, Provedor } from "@/types/database";

interface ClienteRevisao {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  valor: string;
  descricao: string;
  vencimento: string;
  dependentesCobrancaIds: string[];
  dependentesResumo: string;
  sugestaoWhatsapp?: SugestaoWhatsapp;
}

function valorToMask(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function defaultVencimentoBr(dia: number) {
  return formatIsoToBrDate(nextDueDateFromDay(dia));
}

function telefoneValido(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && isValidPhone(digits);
}

function resolverVencimentoSugerido(vencimentoBr: string, diaPadrao: number) {
  if (!isValidDateInput(vencimentoBr)) return defaultVencimentoBr(diaPadrao);

  const iso = parseDateInput(vencimentoBr);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (iso && new Date(`${iso}T12:00:00`) < hoje) {
    return defaultVencimentoBr(diaPadrao);
  }
  return vencimentoBr;
}

export function FinanceiroPanel({
  pendentes,
  preCadastros,
  defaults,
  provedoresById,
}: {
  pendentes: (Beneficiario & { dependentes?: Beneficiario[] })[];
  preCadastros: PreCadastroWhatsapp[];
  defaults: { valor: number; dia: number; descricao: string };
  provedoresById: Map<string, Provedor>;
}) {
  const router = useRouter();
  const preCadastrosByCpf = useMemo(
    () => buildPreCadastrosByCpf(preCadastros),
    [preCadastros]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [revisao, setRevisao] = useState<ClienteRevisao[]>([]);

  const filtered = useMemo(() => {
    if (!search.trim()) return pendentes;
    return filterSortTitularesComDependentes(
      pendentes.map((p) => ({ ...p, dependentes: [] })),
      search
    );
  }, [pendentes, search]);

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openModal() {
    if (selected.size === 0) {
      toast.error("Selecione ao menos um cliente");
      return;
    }
    const selecionados = filtered.filter((p) => selected.has(p.id));
    const lista = selecionados.map((p) => {
      const resolved = resolveAssinaturaDefaults(p, provedoresById, defaults);
      const pre = preCadastrosByCpf.get(normalizeCpf(p.cpf));
      return {
        id: p.id,
        nome: p.nome,
        cpf: maskCpfInput(p.cpf),
        telefone: maskPhoneInput(p.telefone ?? ""),
        valor: valorToMask(resolved.valor),
        descricao: resolved.descricao,
        vencimento: "",
        dependentesCobrancaIds: resolved.dependentesCobrancaIds ?? [],
        dependentesResumo:
          resolved.cobrarDependentes && resolved.dependentesCobrancaIds?.length
            ? `${resolved.dependentesCobrancaIds.length} dependente(s) incluído(s)`
            : "",
        sugestaoWhatsapp: pre
          ? criarSugestaoWhatsapp(pre, maskPhoneInput)
          : undefined,
      };
    });
    setRevisao(lista);
    setModalSearch("");
    setModalOpen(true);
  }

  function handleModalOpenChange(open: boolean) {
    setModalOpen(open);
    if (!open) setModalSearch("");
  }

  function aplicarVencimentoPadrao() {
    const vencimentoPadrao = defaultVencimentoBr(defaults.dia);
    setRevisao((prev) => prev.map((c) => ({ ...c, vencimento: vencimentoPadrao })));
  }

  function updateRevisao(
    id: string,
    campo: keyof Pick<
      ClienteRevisao,
      "nome" | "telefone" | "valor" | "descricao" | "vencimento"
    >,
    value: string
  ) {
    setRevisao((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (campo === "telefone") return { ...c, telefone: maskPhoneInput(value) };
        if (campo === "valor") return { ...c, valor: maskCurrencyInput(value) };
        if (campo === "vencimento") return { ...c, vencimento: maskDateInput(value) };
        return { ...c, [campo]: value };
      })
    );
  }

  function aplicarSugestaoWhatsapp(id: string) {
    setRevisao((prev) =>
      prev.map((c) => {
        if (c.id !== id || !c.sugestaoWhatsapp) return c;
        const sugestao = c.sugestaoWhatsapp;
        const vencimentoResolvido = resolverVencimentoSugerido(
          sugestao.vencimento,
          defaults.dia
        );
        const vencimentoAjustado = vencimentoResolvido !== sugestao.vencimento;

        if (vencimentoAjustado) {
          toast.info(
            "O vencimento sugerido já passou; o vencimento padrão foi usado na sugestão."
          );
        }

        return {
          ...c,
          telefone: sugestao.telefone || c.telefone,
          vencimento: vencimentoResolvido,
          sugestaoWhatsapp: { ...sugestao, status: "aplicada" },
        };
      })
    );
  }

  function ignorarSugestaoWhatsapp(id: string) {
    setRevisao((prev) =>
      prev.map((c) => {
        if (c.id !== id || !c.sugestaoWhatsapp) return c;
        return {
          ...c,
          sugestaoWhatsapp: { ...c.sugestaoWhatsapp, status: "ignorada" },
        };
      })
    );
  }

  async function handleGerar() {
    if (revisao.some((c) => !c.nome.trim())) {
      toast.error("Todos os clientes precisam de nome");
      return;
    }
    if (revisao.some((c) => parseCurrencyInput(c.valor) <= 0)) {
      toast.error("Todos os clientes precisam de um valor válido");
      return;
    }
    if (revisao.some((c) => !c.descricao.trim())) {
      toast.error("Todos os clientes precisam de uma descrição");
      return;
    }
    if (revisao.some((c) => !c.vencimento.trim())) {
      toast.error("Preencha a data de vencimento de todos os clientes");
      return;
    }
    if (revisao.some((c) => !telefoneValido(c.telefone))) {
      toast.error("Todos os clientes precisam de um WhatsApp válido");
      return;
    }
    if (revisao.some((c) => !isValidDateInput(c.vencimento))) {
      toast.error("Informe uma data de vencimento válida (dd/mm/aaaa) para todos");
      return;
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (
      revisao.some((c) => {
        const iso = parseDateInput(c.vencimento);
        if (!iso) return true;
        return new Date(`${iso}T12:00:00`) < hoje;
      })
    ) {
      toast.error("A data de vencimento não pode ser no passado");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientes: revisao.map((c) => ({
            id: c.id,
            nome: c.nome.trim(),
            telefone: c.telefone.replace(/\D/g, ""),
            valor: parseCurrencyInput(c.valor),
            descricao: c.descricao.trim(),
            dataVencimento: parseDateInput(c.vencimento),
            dependentesCobrancaIds: c.dependentesCobrancaIds,
          })),
        }),
      });
      const data = await res.json();
      const erros = data.results?.filter((r: { success: boolean }) => !r.success) ?? [];
      const sucesso = data.results?.filter((r: { success: boolean }) => r.success) ?? [];

      if (sucesso.length) toast.success(`${sucesso.length} assinatura(s) criada(s)`);
      erros.forEach((e: { error: string }) => toast.error(e.error));

      setModalOpen(false);
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Erro ao gerar assinaturas");
    } finally {
      setLoading(false);
    }
  }

  const totalPrevisto = useMemo(
    () =>
      formatCurrency(
        revisao.reduce((sum, c) => sum + parseCurrencyInput(c.valor), 0)
      ),
    [revisao]
  );

  const podeConfirmar = useMemo(
    () =>
      revisao.length > 0 &&
      revisao.every(
        (c) => isValidDateInput(c.vencimento) && telefoneValido(c.telefone)
      ),
    [revisao]
  );

  const revisaoExibicao = useMemo(() => {
    const q = modalSearch.trim();
    if (!q) return revisao;

    return [...revisao].sort((a, b) => {
      const scoreA = scorePerson(
        { nome: a.nome, cpf: a.cpf, telefone: a.telefone },
        q
      );
      const scoreB = scorePerson(
        { nome: b.nome, cpf: b.cpf, telefone: b.telefone },
        q
      );
      return scoreB - scoreA;
    });
  }, [revisao, modalSearch]);

  const correspondentesModal = useMemo(() => {
    const q = modalSearch.trim();
    if (!q) return revisaoExibicao.length;
    return revisaoExibicao.filter((c) =>
      matchesPerson({ nome: c.nome, cpf: c.cpf, telefone: c.telefone }, q)
    ).length;
  }, [revisaoExibicao, modalSearch]);

  const sugestoesPendentes = useMemo(
    () =>
      revisao.filter((c) => c.sugestaoWhatsapp?.status === "pendente").length,
    [revisao]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Pesquisar por nome, CPF ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button className="w-full sm:w-auto" onClick={openModal} disabled={selected.size === 0}>
          Gerar Assinaturas ({selected.size})
        </Button>
      </div>

      <p className="text-sm text-slate-500">
        {search.trim()
          ? `${filtered.length} de ${pendentes.length} titular(es) encontrado(s)`
          : `${pendentes.length} titular(es) sem assinatura (ativos e elegíveis)`}
      </p>

      <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Plano</th>
              <th className="px-4 py-3 text-left font-medium">Telefone</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                  />
                </td>
                <td className="px-4 py-3 font-medium">{p.nome}</td>
                <td className="px-4 py-3">{p.plano ?? "-"}</td>
                <td className="px-4 py-3">{formatPhone(p.telefone)}</td>
                <td className="px-4 py-3">{p.email ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-8 text-center text-slate-500">
            {search.trim()
              ? "Nenhum titular encontrado para esta busca."
              : "Nenhum cliente pendente de cobrança."}
          </p>
        )}
      </TableScroll>

      <Dialog open={modalOpen} onOpenChange={handleModalOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerar assinaturas ({revisao.length})</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Valor e descrição vêm do provedor (ou padrão global). A data de
              vencimento fica em branco — preencha manualmente ou use a sugestão
              do pré-cadastro WhatsApp quando o CPF coincidir.
              {sugestoesPendentes > 0 && (
                <span className="mt-1 block font-medium text-emerald-700 dark:text-emerald-300">
                  {sugestoesPendentes} cliente(s) com sugestão WhatsApp pendente.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Vencimento padrão: dia {defaults.dia} do próximo mês
              </p>
              <Button type="button" variant="outline" size="sm" onClick={aplicarVencimentoPadrao}>
                Aplicar vencimento padrão a todos
              </Button>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">
                  Revisar clientes ({revisao.length})
                </label>
                <span className="text-xs text-slate-500">
                  Total previsto: {totalPrevisto}/mês
                </span>
              </div>

              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Pesquisar por nome, CPF ou telefone..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                />
              </div>
              {modalSearch.trim() && (
                <p className="mb-2 text-xs text-slate-500">
                  {correspondentesModal === 0
                    ? "Nenhum cliente corresponde à busca (os dados preenchidos foram mantidos)."
                    : `${correspondentesModal} correspondente(s) no topo de ${revisao.length} cliente(s)`}
                </p>
              )}

              <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                {revisaoExibicao.map((c) => {
                  const destaque = modalSearch.trim()
                    ? matchesPerson(
                        { nome: c.nome, cpf: c.cpf, telefone: c.telefone },
                        modalSearch
                      )
                    : false;

                  return (
                  <div
                    key={c.id}
                    className={`space-y-2 rounded-lg p-3 ${
                      destaque
                        ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
                        : "bg-slate-50 dark:bg-slate-900"
                    }`}
                  >
                    <p className="text-xs font-medium text-slate-500">{c.nome}</p>
                    {c.sugestaoWhatsapp?.status === "pendente" && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          Pré-cadastro WhatsApp encontrado (CPF)
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.sugestaoWhatsapp.etiquetas.map((etiqueta) => (
                            <Badge key={etiqueta} variant="secondary">
                              {etiqueta}
                            </Badge>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                          WhatsApp sugerido: {c.sugestaoWhatsapp.telefone || "—"}
                          <br />
                          Adesão (data da etiqueta): {c.sugestaoWhatsapp.dataEtiqueta}
                          <br />
                          1º vencimento sugerido: {c.sugestaoWhatsapp.vencimento}{" "}
                          (1 mês após a adesão)
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => aplicarSugestaoWhatsapp(c.id)}
                          >
                            Aplicar sugestão
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => ignorarSugestaoWhatsapp(c.id)}
                          >
                            Ignorar
                          </Button>
                        </div>
                      </div>
                    )}
                    {c.sugestaoWhatsapp?.status === "aplicada" && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Sugestão WhatsApp aplicada.
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">Nome</label>
                        <Input
                          value={c.nome}
                          onChange={(e) => updateRevisao(c.id, "nome", e.target.value)}
                          placeholder="Nome"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">CPF</label>
                        <Input value={c.cpf} readOnly className="bg-slate-100 dark:bg-slate-800" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">
                          WhatsApp *
                        </label>
                        <Input
                          value={c.telefone}
                          onChange={(e) => updateRevisao(c.id, "telefone", e.target.value)}
                          placeholder="(00) 00000-0000"
                          inputMode="numeric"
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">
                          1º vencimento *
                        </label>
                        <Input
                          value={c.vencimento}
                          onChange={(e) => updateRevisao(c.id, "vencimento", e.target.value)}
                          placeholder="dd/mm/aaaa"
                          inputMode="numeric"
                          maxLength={10}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">
                          Valor mensal
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                            R$
                          </span>
                          <Input
                            className="pl-9"
                            value={c.valor}
                            onChange={(e) => updateRevisao(c.id, "valor", e.target.value)}
                            placeholder="0,00"
                            inputMode="numeric"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">
                          Descrição
                        </label>
                        <Input
                          value={c.descricao}
                          onChange={(e) => updateRevisao(c.id, "descricao", e.target.value)}
                          placeholder="Mensalidade..."
                        />
                      </div>
                    </div>
                    {c.dependentesResumo && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        {c.dependentesResumo}. O valor já inclui os dependentes
                        cobrados conforme o provedor.
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleGerar}
              disabled={loading || !podeConfirmar}
            >
              {loading
                ? "Gerando..."
                : `Confirmar ${revisao.length} assinatura(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
