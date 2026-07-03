"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, maskPhoneInput, statusLabel } from "@/lib/utils";
import {
  getVariablesForEvent,
  renderTemplatePreview,
} from "@/lib/message-templates";
import type {
  Beneficiario,
  Mensagem,
  MensagemTemplate,
  TipoEnvioMensagem,
} from "@/types/database";
import type { TesteEnvioTipo } from "@/lib/uazapi/test-send";

const tipoEnvioOptions: Array<{ value: TipoEnvioMensagem; label: string }> = [
  { value: "texto", label: "Texto simples" },
  { value: "botao_pix", label: "Botão Copiar PIX" },
  { value: "botoes_pix_boleto", label: "Botões PIX + boleto" },
  { value: "botoes_pagamento", label: "Botões PIX + boleto + fatura" },
];

type MensagemComBeneficiario = Mensagem & {
  beneficiario: Beneficiario | Beneficiario[] | null;
};

interface ClienteOption {
  id: string;
  nome: string;
  telefone: string | null;
  cpf: string;
}

interface PessoaOption {
  id: string;
  nome: string;
  telefone: string | null;
}

type MensagensPagination = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

type MensagensFiltros = {
  de: string;
  ate: string;
  pessoa: string;
  q: string;
};

function buildMensagensUrl(
  de: string,
  ate: string,
  page: number,
  pessoa: string,
  q: string
) {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  if (pessoa) params.set("pessoa", pessoa);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/mensagens${qs ? `?${qs}` : ""}`;
}

export function MensagensPanel({
  mensagens,
  templates,
  clientes,
  pessoas,
  pagination,
  filtros,
}: {
  mensagens: MensagemComBeneficiario[];
  templates: MensagemTemplate[];
  clientes: ClienteOption[];
  pessoas: PessoaOption[];
  pagination: MensagensPagination;
  filtros: MensagensFiltros;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"historico" | "templates" | "testar">("historico");
  const [editedTemplates, setEditedTemplates] = useState(templates);
  const [loading, setLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEditedTemplates(templates);
  }, [templates]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testBeneficiarioId, setTestBeneficiarioId] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testTemplateId, setTestTemplateId] = useState("");
  const [testSendType, setTestSendType] = useState<TesteEnvioTipo>("texto");
  const [livePreview, setLivePreview] = useState("");
  const [previewMeta, setPreviewMeta] = useState({
    usandoDadosReais: false,
    temAssinatura: false,
    temCobrancaPendente: false,
    temCodigoPix: false,
    temLinhaDigitavel: false,
    temLinkFatura: false,
  });
  const [detalheMensagem, setDetalheMensagem] = useState<MensagemComBeneficiario | null>(
    null
  );
  const [buscaDraft, setBuscaDraft] = useState(filtros.q);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setBuscaDraft(filtros.q);
  }, [filtros.q]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function aplicarFiltrosData(de: string, ate: string) {
    router.push(buildMensagensUrl(de, ate, 1, filtros.pessoa, filtros.q));
  }

  function aplicarPessoa(pessoa: string) {
    router.push(buildMensagensUrl(filtros.de, filtros.ate, 1, pessoa, filtros.q));
  }

  function aplicarBusca() {
    router.push(
      buildMensagensUrl(filtros.de, filtros.ate, 1, filtros.pessoa, buscaDraft.trim())
    );
  }

  function limparFiltros() {
    setBuscaDraft("");
    router.push("/mensagens");
  }

  function irParaPagina(page: number) {
    router.push(
      buildMensagensUrl(filtros.de, filtros.ate, page, filtros.pessoa, filtros.q)
    );
  }

  const temFiltrosAtivos = Boolean(
    filtros.de || filtros.ate || filtros.pessoa || filtros.q
  );

  const previewTemplate = useMemo(() => {
    if (testTemplateId && livePreview) return livePreview;
    if (!testTemplateId) return "";
    const template = editedTemplates.find((t) => t.id === testTemplateId);
    if (!template) return "";
    return renderTemplatePreview(template.corpo);
  }, [testTemplateId, editedTemplates, livePreview]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!testTemplateId) {
      setLivePreview("");
      setPreviewMeta({
        usandoDadosReais: false,
        temAssinatura: false,
        temCobrancaPendente: false,
        temCodigoPix: false,
        temLinhaDigitavel: false,
        temLinkFatura: false,
      });
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);

    fetch("/api/messages/test/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: testTemplateId,
        beneficiarioId: testBeneficiarioId || undefined,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (cancelled) return;
        setLivePreview(data.preview ?? "");
        setPreviewMeta({
          usandoDadosReais: !!data.usandoDadosReais,
          temAssinatura: !!data.temAssinatura,
          temCobrancaPendente: !!data.temCobrancaPendente,
          temCodigoPix: Boolean(data.vars?.codigo_pix),
          temLinhaDigitavel: Boolean(data.vars?.linha_digitavel),
          temLinkFatura: Boolean(data.vars?.link_fatura),
        });
        setTestSendType((prev) => {
          if (prev === "botao_pix" && !data.vars?.codigo_pix) return "texto";
          if (
            prev === "botoes_pix_boleto" &&
            (!data.vars?.codigo_pix || !data.vars?.linha_digitavel)
          ) {
            return "texto";
          }
          if (
            prev === "botoes_pagamento" &&
            (!data.vars?.codigo_pix ||
              !data.vars?.linha_digitavel ||
              !data.vars?.link_fatura)
          ) {
            return "texto";
          }
          return prev;
        });
        if (data.telefone && testBeneficiarioId) {
          setTestPhone(maskPhoneInput(data.telefone));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setLivePreview("");
          toast.error(
            e instanceof Error ? e.message : "Erro ao carregar prévia do template"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [testTemplateId, testBeneficiarioId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleClienteChange(id: string) {
    setTestBeneficiarioId(id);
    const cliente = clientes.find((c) => c.id === id);
    if (cliente?.telefone) {
      setTestPhone(maskPhoneInput(cliente.telefone));
    } else if (!id) {
      setTestPhone("");
    }
  }

  async function handleTestSend() {
    setLoading(true);
    try {
      const res = await fetch("/api/messages/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: testPhone,
          mensagem: testTemplateId ? undefined : testMessage,
          templateId: testTemplateId || undefined,
          beneficiarioId: testBeneficiarioId || undefined,
          tipoEnvioTeste: testSendType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar");
      toast.success("Mensagem de teste enviada!");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/${id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Erro no reenvio");
      toast.success("Mensagem reenviada");
      router.refresh();
    } catch {
      toast.error("Falha no reenvio");
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate(template: MensagemTemplate) {
    try {
      const res = await fetch(`/api/messages/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corpo: template.corpo,
          titulo: template.titulo,
          ativo: template.ativo,
          tipo_envio: template.tipo_envio,
          max_tentativas: template.max_tentativas,
          intervalo_retry_minutos: template.intervalo_retry_minutos,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar template");

      if (data.template) {
        setEditedTemplates((prev) =>
          prev.map((item) => (item.id === data.template.id ? data.template : item))
        );
      }

      toast.success("Template salvo");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar template");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTab("historico")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "historico"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Histórico
        </button>
        <button
          onClick={() => setTab("templates")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "templates"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Templates ({templates.length})
        </button>
        <button
          onClick={() => setTab("testar")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "testar"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Testar envio
        </button>
      </div>

      {tab === "testar" ? (
        <Card>
          <CardHeader>
            <CardTitle>Testar mensagem WhatsApp</CardTitle>
            <CardDescription>
              Selecione um cliente e um template para testar com dados reais da
              assinatura e cobrança. Você pode enviar com botão Copiar PIX na
              Uazapi. O WhatsApp pode ser editado antes do envio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Cliente</label>
              <select
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={testBeneficiarioId}
                onChange={(e) => handleClienteChange(e.target.value)}
              >
                <option value="">Dados de exemplo (sem cliente)</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {!c.telefone ? " — sem telefone" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Selecione um cliente para usar nome, assinatura e cobrança reais no
                template.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Telefone (com DDD)
              </label>
              <Input
                placeholder="(19) 99999-9999"
                value={testPhone}
                onChange={(e) => setTestPhone(maskPhoneInput(e.target.value))}
                inputMode="numeric"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Usar template (opcional)
              </label>
              <select
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={testTemplateId}
                onChange={(e) => {
                  setTestTemplateId(e.target.value);
                  if (!e.target.value) setTestSendType("texto");
                }}
              >
                <option value="">Mensagem personalizada</option>
                {editedTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.titulo}
                    {!t.ativo ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Tipo de envio de teste
              </label>
              <select
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={testSendType}
                onChange={(e) => setTestSendType(e.target.value as TesteEnvioTipo)}
              >
                <option value="texto">Texto simples</option>
                <option value="botao_pix" disabled={!testTemplateId || !previewMeta.temCodigoPix}>
                  Botão Copiar PIX
                </option>
                <option
                  value="botoes_pix_boleto"
                  disabled={
                    !testTemplateId ||
                    !previewMeta.temCodigoPix ||
                    !previewMeta.temLinhaDigitavel
                  }
                >
                  Botões Copiar PIX + Copiar boleto
                </option>
                <option
                  value="botoes_pagamento"
                  disabled={
                    !testTemplateId ||
                    !previewMeta.temCodigoPix ||
                    !previewMeta.temLinhaDigitavel ||
                    !previewMeta.temLinkFatura
                  }
                >
                  Botões PIX + boleto + abrir fatura
                </option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {!testTemplateId
                  ? "Selecione um template para habilitar os botões."
                  : previewLoading
                    ? "Carregando dados de pagamento..."
                    : testSendType === "botao_pix"
                      ? "Envia /send/menu com Copiar PIX|copy:{{codigo_pix}}."
                      : testSendType === "botoes_pix_boleto"
                        ? "Envia dois botões: PIX copia e cola e linha digitável do boleto."
                        : testSendType === "botoes_pagamento"
                          ? "Envia três botões: copiar PIX, copiar boleto e abrir fatura."
                        : "Envia a mensagem como texto normal."}
              </p>
            </div>

            {testTemplateId ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <label className="text-sm font-medium">Prévia</label>
                  {previewMeta.usandoDadosReais && (
                    <Badge variant="success">Dados reais</Badge>
                  )}
                  {previewMeta.temAssinatura && (
                    <Badge variant="default">Com assinatura</Badge>
                  )}
                  {previewMeta.temCobrancaPendente && (
                    <Badge variant="default">Com cobrança</Badge>
                  )}
                  {previewMeta.temCodigoPix && (
                    <Badge variant="success">Com PIX</Badge>
                  )}
                  {previewMeta.temLinhaDigitavel && (
                    <Badge variant="success">Com boleto</Badge>
                  )}
                  {previewMeta.temLinkFatura && (
                    <Badge variant="success">Com link</Badge>
                  )}
                  {previewLoading && (
                    <span className="text-xs text-slate-500">Carregando...</span>
                  )}
                </div>
                <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                  {previewTemplate || "Carregando prévia..."}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium">Mensagem</label>
                <textarea
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  rows={4}
                  placeholder="Digite a mensagem de teste..."
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
            )}

            <Button onClick={handleTestSend} disabled={loading}>
              <Send className="mr-2 h-4 w-4" />
              {loading ? "Enviando..." : "Enviar teste"}
            </Button>
          </CardContent>
        </Card>
      ) : tab === "historico" ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs text-slate-500">
                Pesquisar por nome ou telefone
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Nome ou número..."
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
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Pessoa</label>
              <select
                className="flex h-10 min-w-[200px] rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={filtros.pessoa}
                onChange={(e) => aplicarPessoa(e.target.value)}
              >
                <option value="">Todas as pessoas</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.telefone ? ` — ${p.telefone}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">De</label>
              <Input
                type="date"
                value={filtros.de}
                onChange={(e) => aplicarFiltrosData(e.target.value, filtros.ate)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Até</label>
              <Input
                type="date"
                value={filtros.ate}
                onChange={(e) => aplicarFiltrosData(filtros.de, e.target.value)}
              />
            </div>
            {temFiltrosAtivos && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={limparFiltros}
              >
                Limpar filtros
              </Button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            {pagination.total === 0
              ? "Nenhuma mensagem encontrada"
              : `Exibindo ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                )} de ${pagination.total} mensagem(ns)`}
          </p>

          <TableScroll className="rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium">Número</th>
                  <th className="px-4 py-3 text-left font-medium">Mensagem</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {mensagens.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {temFiltrosAtivos
                        ? "Nenhuma mensagem encontrada com os filtros aplicados."
                        : "Nenhuma mensagem nesta página."}
                    </td>
                  </tr>
                ) : (
                  mensagens.map((m) => {
                  const b = Array.isArray(m.beneficiario)
                    ? m.beneficiario[0]
                    : m.beneficiario;
                  return (
                    <tr key={m.id}>
                      <td className="px-4 py-3">{b?.nome ?? "-"}</td>
                      <td className="px-4 py-3">{m.telefone}</td>
                      <td className="max-w-xs truncate px-4 py-3">
                        <button
                          type="button"
                          className="block w-full truncate text-left hover:text-emerald-600"
                          title="Ver mensagem completa"
                          onClick={() => setDetalheMensagem(m)}
                        >
                          {m.mensagem}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            m.status === "enviado"
                              ? "success"
                              : m.status === "erro"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {statusLabel(m.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{formatDateTime(m.enviado_em ?? m.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDetalheMensagem(m)}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            Ver
                          </Button>
                          {m.status === "erro" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={loading}
                              onClick={() => handleRetry(m.id)}
                            >
                              Reenviar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  })
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

          <Dialog
            open={detalheMensagem !== null}
            onOpenChange={(open) => {
              if (!open) setDetalheMensagem(null);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              {detalheMensagem && (() => {
                const b = Array.isArray(detalheMensagem.beneficiario)
                  ? detalheMensagem.beneficiario[0]
                  : detalheMensagem.beneficiario;
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>Mensagem enviada</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="font-medium text-slate-500">Cliente: </span>
                        {b?.nome ?? "-"}
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">Telefone: </span>
                        {detalheMensagem.telefone}
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">Status: </span>
                        {statusLabel(detalheMensagem.status)}
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">Data: </span>
                        {formatDateTime(
                          detalheMensagem.enviado_em ?? detalheMensagem.created_at
                        )}
                      </div>
                      {detalheMensagem.erro && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                          <span className="font-medium">Erro: </span>
                          {detalheMensagem.erro}
                        </div>
                      )}
                      <div>
                        <p className="mb-1 font-medium text-slate-500">Conteúdo</p>
                        <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                          {detalheMensagem.mensagem}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="space-y-4">
          {editedTemplates.map((t, i) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">{t.titulo}</h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={t.ativo}
                    onChange={(e) => {
                      const next = [...editedTemplates];
                      next[i] = { ...t, ativo: e.target.checked };
                      setEditedTemplates(next);
                    }}
                  />
                  Ativo
                </label>
              </div>
              <p className="mb-2 text-xs text-slate-500">Evento: {t.evento}</p>
              <p className="mb-2 text-xs text-slate-500">
                Variáveis:{" "}
                {getVariablesForEvent(t.evento)
                  .map((v) => `{{${v}}}`)
                  .join(", ")}
              </p>
              <div className="mb-3 grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Tipo de envio automático
                  </label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                    value={t.tipo_envio ?? "texto"}
                    onChange={(e) => {
                      const next = [...editedTemplates];
                      next[i] = {
                        ...t,
                        tipo_envio: e.target.value as TipoEnvioMensagem,
                      };
                      setEditedTemplates(next);
                    }}
                  >
                    {tipoEnvioOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Máx. tentativas
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={t.max_tentativas ?? 3}
                    onChange={(e) => {
                      const next = [...editedTemplates];
                      next[i] = {
                        ...t,
                        max_tentativas: Math.max(1, Number(e.target.value) || 1),
                      };
                      setEditedTemplates(next);
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Retry (minutos)
                  </label>
                  <Input
                    value={(t.intervalo_retry_minutos ?? [10, 30, 60]).join(",")}
                    onChange={(e) => {
                      const intervals = e.target.value
                        .split(",")
                        .map((v) => Number(v.trim()))
                        .filter((v) => Number.isFinite(v) && v > 0);
                      const next = [...editedTemplates];
                      next[i] = {
                        ...t,
                        intervalo_retry_minutos: intervals.length ? intervals : [10],
                      };
                      setEditedTemplates(next);
                    }}
                    placeholder="10,30,60"
                  />
                </div>
              </div>
              <textarea
                className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                rows={3}
                value={t.corpo}
                onChange={(e) => {
                  const next = [...editedTemplates];
                  next[i] = { ...t, corpo: e.target.value };
                  setEditedTemplates(next);
                }}
              />
              <Button
                size="sm"
                className="mt-2"
                onClick={() => saveTemplate(editedTemplates[i])}
              >
                Salvar template
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
