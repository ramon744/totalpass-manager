"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ConfigAsaas,
  ConfigBridge,
  ConfigCron,
  ConfigEmpresa,
  ConfigFinanceiro,
  ConfigInfinity,
  ConfigUazapi,
} from "@/types/database";
import {
  DEFAULT_BRIDGE_CONFIG,
  DEFAULT_CRON_CONFIG,
  DEFAULT_INFINITY_CONFIG,
} from "@/types/database";
import {
  brtTimeToUtc,
  formatCronTimeValue,
  parseCronTimeValue,
} from "@/lib/cron-config";
import { getAsaasWebhookUrl, getUazapiWebhookUrl } from "@/types/database";
import {
  FORMA_PAGAMENTO_OPCOES,
  getFormaPagamentoPadrao,
} from "@/lib/assinatura-billing";
import {
  maskEmailInput,
  maskPhoneInput,
  normalizePhone,
} from "@/lib/utils";
import Link from "next/link";

interface Props {
  empresa: ConfigEmpresa;
  financeiro: ConfigFinanceiro;
  asaas: ConfigAsaas;
  uazapi: ConfigUazapi;
  cron: ConfigCron;
  bridge: ConfigBridge;
  infinity: ConfigInfinity;
  infinityStatus?: {
    instances: Array<{
      installation_id: string;
      last_seen_at: string;
      session_ok: boolean;
      overdue_count?: number;
      extension_version: string | null;
    }>;
    overdue: number;
    pending: number;
    paid: number;
    health?: {
      online: boolean;
      reason: string;
      lastSeenAt: string | null;
    };
  };
  bridgeStatus?: {
    instances: Array<{
      installation_id: string;
      last_seen_at: string;
      session_ok: boolean;
      pending_jobs_count: number;
      extension_version: string | null;
    }>;
    pending: number;
    failed: number;
    succeededToday: number;
    pendentesManuaisCount?: number;
  };
}

export function ConfiguracoesForm({
  empresa: empresaInit,
  financeiro: financeiroInit,
  asaas: asaasInit,
  uazapi: uazapiInit,
  cron: cronInit,
  bridge: bridgeInit,
  infinity: infinityInit,
  infinityStatus: infinityStatusInit,
  bridgeStatus: bridgeStatusInit,
}: Props) {
  const [empresa, setEmpresa] = useState(empresaInit);
  const [financeiro, setFinanceiro] = useState(financeiroInit);
  const [asaas, setAsaas] = useState(asaasInit);
  const [uazapi, setUazapi] = useState(uazapiInit);
  const [cron, setCron] = useState(cronInit);
  const [bridge, setBridge] = useState({
    ...DEFAULT_BRIDGE_CONFIG,
    ...bridgeInit,
    admin_telefone: maskPhoneInput(bridgeInit.admin_telefone ?? ""),
    admin_email: maskEmailInput(bridgeInit.admin_email ?? ""),
  });
  const [infinity, setInfinity] = useState({
    ...DEFAULT_INFINITY_CONFIG,
    ...infinityInit,
    admin_telefone: maskPhoneInput(infinityInit.admin_telefone ?? ""),
    admin_email: maskEmailInput(infinityInit.admin_email ?? ""),
    bridge_secret: infinityInit.bridge_secret ?? "",
  });
  const [bridgeStatus, setBridgeStatus] = useState(bridgeStatusInit);
  const [infinityStatus, setInfinityStatus] = useState(infinityStatusInit);
  const [infinityJobs, setInfinityJobs] = useState<{
    pending: number;
    running: number;
    today: number;
    teto: number;
    dry_run: boolean;
    ativa: boolean;
    recent: Array<{
      id: string;
      tipo: string;
      status: string;
      dry_run: boolean;
      last_error: string | null;
      created_at: string;
      completed_at: string | null;
      payload?: Record<string, unknown> | null;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningReminders, setRunningReminders] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState(false);
  const [loadingInfinityJobs, setLoadingInfinityJobs] = useState(false);

  async function refreshInfinityJobs() {
    setLoadingInfinityJobs(true);
    try {
      const res = await fetch("/api/infinity/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar fila");
      setInfinityJobs(data);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao carregar fila Infinity"
      );
    } finally {
      setLoadingInfinityJobs(false);
    }
  }

  async function salvar(chave: string, valor: object) {
    setLoading(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave, valor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Configuração salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  async function salvarCron() {
    setLoading(true);
    try {
      const res = await fetch("/api/config/cron", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hora_agendamento: cron.hora_agendamento,
          minuto_agendamento: cron.minuto_agendamento,
          janela_inicio: cron.janela_inicio,
          janela_inicio_minuto: cron.janela_inicio_minuto,
          janela_fim: cron.janela_fim,
          janela_fim_minuto: cron.janela_fim_minuto,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.cron) setCron(data.cron);
      if (data.aviso) {
        toast.warning(data.aviso);
      } else {
        toast.success("Horários de lembretes salvos");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar lembretes");
    } finally {
      setLoading(false);
    }
  }

  async function executarLembretesAgora() {
    setRunningReminders(true);
    try {
      const res = await fetch("/api/config/cron", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Lembretes: ${data.scheduled} agendado(s), ${data.sent} enviado(s)${
          data.pending ? `, ${data.pending} pendente(s)` : ""
        }`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar lembretes");
    } finally {
      setRunningReminders(false);
    }
  }

  async function reprocessarJobsFalhos() {
    setRetryingJobs(true);
    try {
      const res = await fetch("/api/totalpass/bridge/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_failed" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.retried} job(s) reenviado(s) para a fila`);
      const statusRes = await fetch("/api/totalpass/bridge/status");
      if (statusRes.ok) setBridgeStatus(await statusRes.json());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao reprocessar");
    } finally {
      setRetryingJobs(false);
    }
  }

  const horaAgendamento = cron.hora_agendamento ?? DEFAULT_CRON_CONFIG.hora_agendamento;
  const minutoAgendamento =
    cron.minuto_agendamento ?? DEFAULT_CRON_CONFIG.minuto_agendamento;
  const utcAgendamento = brtTimeToUtc(horaAgendamento, minutoAgendamento);

  const janelaInicioH = cron.janela_inicio ?? DEFAULT_CRON_CONFIG.janela_inicio;
  const janelaInicioM =
    cron.janela_inicio_minuto ?? DEFAULT_CRON_CONFIG.janela_inicio_minuto;
  const janelaFimH = cron.janela_fim ?? DEFAULT_CRON_CONFIG.janela_fim;
  const janelaFimM = cron.janela_fim_minuto ?? DEFAULT_CRON_CONFIG.janela_fim_minuto;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
          <CardDescription>Dados e identidade visual</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input
              value={empresa.nome}
              onChange={(e) => setEmpresa({ ...empresa, nome: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">CNPJ</label>
            <Input
              value={empresa.cnpj}
              onChange={(e) => setEmpresa({ ...empresa, cnpj: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">URL do Logo</label>
            <Input
              value={empresa.logo_url}
              onChange={(e) => setEmpresa({ ...empresa, logo_url: e.target.value })}
            />
          </div>
          <Button disabled={loading} onClick={() => salvar("empresa", empresa)}>
            Salvar empresa
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Financeiro</CardTitle>
          <CardDescription>Valores padrão para novas assinaturas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Valor mensalidade (R$)</label>
            <Input
              type="number"
              step="0.01"
              value={financeiro.valor_mensalidade_padrao}
              onChange={(e) =>
                setFinanceiro({
                  ...financeiro,
                  valor_mensalidade_padrao: Number(e.target.value),
                })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Dia vencimento padrão</label>
            <Input
              type="number"
              min={1}
              max={28}
              value={financeiro.dia_vencimento_padrao}
              onChange={(e) =>
                setFinanceiro({
                  ...financeiro,
                  dia_vencimento_padrao: Number(e.target.value),
                })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição padrão</label>
            <Input
              value={financeiro.descricao_padrao}
              onChange={(e) =>
                setFinanceiro({ ...financeiro, descricao_padrao: e.target.value })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Forma de pagamento padrão
            </label>
            <select
              className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={getFormaPagamentoPadrao(financeiro)}
              onChange={(e) =>
                setFinanceiro({
                  ...financeiro,
                  forma_pagamento_padrao: e.target.value as typeof financeiro.forma_pagamento_padrao,
                })
              }
            >
              {FORMA_PAGAMENTO_OPCOES.map((opcao) => (
                <option key={opcao.value} value={opcao.value}>
                  {opcao.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {
                FORMA_PAGAMENTO_OPCOES.find(
                  (o) => o.value === getFormaPagamentoPadrao(financeiro)
                )?.descricao
              }
            </p>
          </div>
          <Button disabled={loading} onClick={() => salvar("financeiro", financeiro)}>
            Salvar financeiro
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asaas</CardTitle>
          <CardDescription>
            Cole esta URL no painel do Asaas:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">
              URL do webhook (Supabase)
            </p>
            <code className="break-all text-xs">
              {asaas.webhook_url ?? getAsaasWebhookUrl()}
            </code>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">API Key</label>
            <Input
              type="password"
              value={asaas.api_key}
              onChange={(e) => setAsaas({ ...asaas, api_key: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Ambiente</label>
            <select
              className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={asaas.ambiente}
              onChange={(e) =>
                setAsaas({
                  ...asaas,
                  ambiente: e.target.value as "sandbox" | "production",
                })
              }
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Produção</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Token do webhook
            </label>
            <Input
              type="password"
              value={asaas.webhook_token ?? ""}
              onChange={(e) =>
                setAsaas({ ...asaas, webhook_token: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Use este mesmo token no campo de autenticação do webhook no Asaas.
            </p>
          </div>
          <Button disabled={loading} onClick={() => salvar("asaas", asaas)}>
            Salvar Asaas
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uazapi (WhatsApp)</CardTitle>
          <CardDescription>
            Integração de mensagens automáticas. Cole a URL do webhook no painel
            da Uazapi (Webhooks).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">
              URL do webhook (Supabase)
            </p>
            <code className="break-all text-xs">
              {getUazapiWebhookUrl(uazapi.webhook_token)}
            </code>
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              URL fixa no Supabase — não muda ao publicar na Vercel. O token vai
              na query (<code>?token=...</code>). Eventos sugeridos: contatos,
              chats, etiquetas (labels).
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Token do webhook
            </label>
            <Input
              type="password"
              value={uazapi.webhook_token ?? ""}
              onChange={(e) =>
                setUazapi({ ...uazapi, webhook_token: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Deve ser o mesmo token incluído na URL acima. Eventos sugeridos na
              Uazapi: contatos, chats, etiquetas (labels).
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Etiquetas monitoradas (pré-cadastro)
            </label>
            <Input
              value={(uazapi.etiquetas_monitoradas ?? []).join(", ")}
              onChange={(e) =>
                setUazapi({
                  ...uazapi,
                  etiquetas_monitoradas: e.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="cliente totalpass, cliente gympass"
            />
            <p className="mt-1 text-xs text-slate-500">
              Contatos com essas etiquetas entram em Pré-cadastros. Ao remover a
              etiqueta no WhatsApp, o pré-cadastro é excluído automaticamente.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">URL da API</label>
            <Input
              value={uazapi.url}
              onChange={(e) => setUazapi({ ...uazapi, url: e.target.value })}
              placeholder="https://trackergo.uazapi.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Token da instância</label>
            <Input
              type="password"
              value={uazapi.token}
              onChange={(e) => setUazapi({ ...uazapi, token: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Instância</label>
            <Input
              value={uazapi.instancia}
              onChange={(e) => setUazapi({ ...uazapi, instancia: e.target.value })}
            />
          </div>
          <Button disabled={loading} onClick={() => salvar("uazapi", uazapi)}>
            Salvar Uazapi
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Bridge / Extensão TotalPass</CardTitle>
          <CardDescription>
            Inativação por inadimplência e alerta se a extensão cair. Aviso
            WhatsApp segue mesmo offline; jobs no HR só com ponte saudável.
            Prazos vencidos para ação manual ficam em Cobranças.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <input
              type="checkbox"
              className="mt-1"
              checked={
                bridge.automacao_inativacao_ativa !== false
              }
              onChange={(e) =>
                setBridge({
                  ...bridge,
                  automacao_inativacao_ativa: e.target.checked,
                })
              }
            />
            <span>
              <span className="font-medium">
                Permitir automação de inativação
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                Ligada: envia aviso de desvínculo; enfileira no HR só com
                extensão online. Offline → aviso continua; você desvincula
                manualmente quem passou do prazo. Ao voltar, ignora quem já
                foi tratado no Manager. Desligada: pausa aviso e fila
                (manutenção).
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Dias de carência (após vencimento)
              </label>
              <Input
                type="number"
                min={0}
                max={60}
                value={bridge.dias_carencia ?? DEFAULT_BRIDGE_CONFIG.dias_carencia}
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    dias_carencia: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Dias do aviso até desvincular
              </label>
              <Input
                type="number"
                min={0}
                max={30}
                value={
                  bridge.dias_aviso_final ?? DEFAULT_BRIDGE_CONFIG.dias_aviso_final
                }
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    dias_aviso_final: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Teto diário de inativações
              </label>
              <Input
                type="number"
                min={1}
                max={200}
                value={
                  bridge.teto_diario_inativacoes ??
                  DEFAULT_BRIDGE_CONFIG.teto_diario_inativacoes
                }
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    teto_diario_inativacoes: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                WhatsApp do admin (alerta offline)
              </label>
              <Input
                value={bridge.admin_telefone ?? ""}
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    admin_telefone: maskPhoneInput(e.target.value),
                  })
                }
                placeholder="(11) 91234-5678"
                inputMode="numeric"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                E-mail do admin (alerta offline)
              </label>
              <Input
                type="email"
                value={bridge.admin_email ?? ""}
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    admin_email: maskEmailInput(e.target.value),
                  })
                }
                placeholder="voce@girosaas.com.br"
                autoComplete="email"
              />
              <p className="mt-1 text-xs text-slate-500">
                Usado no alerta de bridge offline e também quando a Uazapi /
                WhatsApp desconectar (fila de clientes pausada).
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Intervalo entre alertas offline (horas)
              </label>
              <Input
                type="number"
                min={1}
                max={48}
                value={
                  bridge.alerta_offline_intervalo_horas ??
                  DEFAULT_BRIDGE_CONFIG.alerta_offline_intervalo_horas
                }
                onChange={(e) =>
                  setBridge({
                    ...bridge,
                    alerta_offline_intervalo_horas: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={
                bridge.notificar_cancelamento_asaas ??
                DEFAULT_BRIDGE_CONFIG.notificar_cancelamento_asaas
              }
              onChange={(e) =>
                setBridge({
                  ...bridge,
                  notificar_cancelamento_asaas: e.target.checked,
                })
              }
            />
            Notificar beneficiário ao cancelar assinatura no Asaas (após
            inativar no TotalPass)
          </label>
          {bridgeStatus && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
              <p>
                Fila: <strong>{bridgeStatus.pending}</strong> pendente(s),{" "}
                <strong>{bridgeStatus.failed}</strong> falho(s),{" "}
                <strong>{bridgeStatus.succeededToday}</strong> sucesso(s) hoje
                {(bridgeStatus.pendentesManuaisCount ?? 0) > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      href="/cobrancas#desvinculos-pendentes"
                      className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                    >
                      {bridgeStatus.pendentesManuaisCount} prazo(s) vencido(s)
                    </Link>
                  </>
                )}
              </p>
              {bridgeStatus.instances?.[0] ? (
                <p className="mt-1 text-xs text-slate-500">
                  Última extensão:{" "}
                  {bridgeStatus.instances[0].session_ok ? "sessão ok" : "offline"}{" "}
                  ·{" "}
                  {new Date(
                    bridgeStatus.instances[0].last_seen_at
                  ).toLocaleString("pt-BR")}{" "}
                  · v{bridgeStatus.instances[0].extension_version || "?"}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Nenhuma extensão enviou heartbeat ainda.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading}
              onClick={() =>
                salvar("bridge", {
                  dias_carencia: bridge.dias_carencia,
                  dias_aviso_final: bridge.dias_aviso_final,
                  heartbeat_ttl_minutos:
                    bridge.heartbeat_ttl_minutos ??
                    DEFAULT_BRIDGE_CONFIG.heartbeat_ttl_minutos,
                  admin_telefone: normalizePhone(bridge.admin_telefone ?? ""),
                  admin_email: maskEmailInput(bridge.admin_email ?? ""),
                  alerta_offline_intervalo_horas:
                    bridge.alerta_offline_intervalo_horas,
                  teto_diario_inativacoes: bridge.teto_diario_inativacoes,
                  notificar_cancelamento_asaas:
                    bridge.notificar_cancelamento_asaas,
                  automacao_inativacao_ativa:
                    bridge.automacao_inativacao_ativa !== false,
                })
              }
            >
              Salvar bridge
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={retryingJobs || loading}
              onClick={reprocessarJobsFalhos}
            >
              {retryingJobs ? "Reprocessando..." : "Reprocessar jobs falhos"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>InfinitePay (extensão)</CardTitle>
          <CardDescription>
            Extensão Infinity Bridge. Sync de clientes ativo (Fase 2). No sync,
            titular na Infinity → gateway Infinity; se sumir → Asaas. Fase 3:
            fila create/cancel com <strong>dry-run</strong> (extensão simula,
            sem escrita real). Desvínculo automático é Fase 4.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <input
              type="checkbox"
              className="mt-1"
              checked={infinity.ativa === true}
              onChange={(e) =>
                setInfinity({ ...infinity, ativa: e.target.checked })
              }
            />
            <span>
              <span className="font-medium">Ativar integração Infinity</span>
              <span className="mt-1 block text-xs text-slate-500">
                Ligada: a extensão Infinity poderá autenticar e sincronizar.
                Desligada: nenhum sync Infinity (modo seguro).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <input
              type="checkbox"
              className="mt-1"
              checked={infinity.dry_run !== false}
              onChange={(e) =>
                setInfinity({ ...infinity, dry_run: e.target.checked })
              }
            />
            <span>
              <span className="font-medium">Dry-run (não escrever na Infinity)</span>
              <span className="mt-1 block text-xs text-slate-500">
                Manter ligado até validar a Fase 3. Jobs de criar/cancelar não
                chamam a API de verdade (só simulam).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <input
              type="checkbox"
              className="mt-1"
              checked={infinity.automacao_desvinculo_ativa === true}
              onChange={(e) =>
                setInfinity({
                  ...infinity,
                  automacao_desvinculo_ativa: e.target.checked,
                })
              }
            />
            <span>
              <span className="font-medium">
                Automação de desvínculo por atraso Infinity
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                Fase 4: com atraso Infinity (após carência do bridge), avisa no
                WhatsApp e enfileira inativação no TotalPass HR. Com dry-run
                ligado, só registra logs. Deixe desligada até validar o sync.
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Segredo da extensão Infinity
              </label>
              <Input
                type="password"
                value={infinity.bridge_secret ?? ""}
                onChange={(e) =>
                  setInfinity({ ...infinity, bridge_secret: e.target.value })
                }
                placeholder="ou INFINITY_BRIDGE_SECRET no Vercel"
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-slate-500">
                Preferível variável de ambiente. Se ambos existirem, o env
                prevalece.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Teto diário de operações
              </label>
              <Input
                type="number"
                min={1}
                max={200}
                value={
                  infinity.teto_diario_operacoes ??
                  DEFAULT_INFINITY_CONFIG.teto_diario_operacoes
                }
                onChange={(e) =>
                  setInfinity({
                    ...infinity,
                    teto_diario_operacoes: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                WhatsApp admin (alertas Infinity)
              </label>
              <Input
                value={infinity.admin_telefone ?? ""}
                onChange={(e) =>
                  setInfinity({
                    ...infinity,
                    admin_telefone: maskPhoneInput(e.target.value),
                  })
                }
                placeholder="(11) 91234-5678"
                inputMode="numeric"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                E-mail admin (alertas Infinity)
              </label>
              <Input
                type="email"
                value={infinity.admin_email ?? ""}
                onChange={(e) =>
                  setInfinity({
                    ...infinity,
                    admin_email: maskEmailInput(e.target.value),
                  })
                }
                placeholder="voce@girosaas.com.br"
                autoComplete="email"
              />
            </div>
          </div>
          {infinityStatus && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
              <p>
                Sync: <strong>{infinityStatus.overdue}</strong> em atraso ·{" "}
                <strong>{infinityStatus.pending}</strong> pendente ·{" "}
                <strong>{infinityStatus.paid}</strong> pago
                {infinityStatus.health && (
                  <>
                    {" "}
                    · saúde:{" "}
                    <strong>
                      {infinityStatus.health.online ? "online" : "offline"}
                    </strong>
                    {!infinityStatus.health.online &&
                      ` (${infinityStatus.health.reason})`}
                  </>
                )}
              </p>
              {infinityStatus.instances?.[0] ? (
                <p className="mt-1 text-xs text-slate-500">
                  Última extensão:{" "}
                  {infinityStatus.instances[0].session_ok
                    ? "sessão ok"
                    : "offline"}{" "}
                  ·{" "}
                  {new Date(
                    infinityStatus.instances[0].last_seen_at
                  ).toLocaleString("pt-BR")}{" "}
                  · v{infinityStatus.instances[0].extension_version || "?"}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Nenhuma extensão Infinity enviou heartbeat ainda. Carregue a
                  pasta <code>infinity-extension</code> no Chrome e configure o
                  segredo.
                </p>
              )}
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Fila de jobs Infinity (Fase 3)</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loadingInfinityJobs || loading}
                onClick={refreshInfinityJobs}
              >
                {loadingInfinityJobs ? "Atualizando…" : "Atualizar fila"}
              </Button>
            </div>
            {infinityJobs ? (
              <>
                <p className="mt-2">
                  Pendentes: <strong>{infinityJobs.pending}</strong> · Em
                  execução: <strong>{infinityJobs.running}</strong> · Hoje:{" "}
                  <strong>
                    {infinityJobs.today}/{infinityJobs.teto}
                  </strong>{" "}
                  · dry-run:{" "}
                  <strong>{infinityJobs.dry_run ? "ligado" : "desligado"}</strong>
                </p>
                {infinityJobs.recent.length > 0 ? (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600 dark:text-slate-400">
                    {infinityJobs.recent.map((j) => (
                      <li key={j.id}>
                        {new Date(j.created_at).toLocaleString("pt-BR")} ·{" "}
                        {j.tipo === "create_charge"
                          ? "criar cobrança"
                          : "cancelar"}{" "}
                        · {j.status}
                        {j.dry_run ? " (dry-run)" : ""}
                        {typeof j.payload?.nome === "string"
                          ? ` · ${j.payload.nome}`
                          : ""}
                        {j.last_error ? ` — ${j.last_error}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Nenhum job ainda. Use POST /api/infinity/jobs (admin) para
                    enfileirar um teste dry-run.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Clique em Atualizar fila para ver pendentes e histórico recente.
              </p>
            )}
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Com dry-run ligado, a extensão v0.1.5+ processa a fila só simulando.
            Escrita real na InfinitePay fica bloqueada até capturarmos o HAR dos
            endpoints.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={loading}
              onClick={async () => {
                const valor: Record<string, unknown> = {
                  ativa: infinity.ativa === true,
                  automacao_desvinculo_ativa:
                    infinity.automacao_desvinculo_ativa === true,
                  dry_run: infinity.dry_run !== false,
                  heartbeat_ttl_minutos:
                    infinity.heartbeat_ttl_minutos ??
                    DEFAULT_INFINITY_CONFIG.heartbeat_ttl_minutos,
                  alerta_offline_intervalo_horas:
                    infinity.alerta_offline_intervalo_horas ??
                    DEFAULT_INFINITY_CONFIG.alerta_offline_intervalo_horas,
                  teto_diario_operacoes: infinity.teto_diario_operacoes,
                  admin_telefone: normalizePhone(infinity.admin_telefone ?? ""),
                  admin_email: maskEmailInput(infinity.admin_email ?? ""),
                };
                if (infinity.bridge_secret?.trim()) {
                  valor.bridge_secret = infinity.bridge_secret.trim();
                }
                await salvar("infinity", valor);
                setInfinity((prev) => ({ ...prev, bridge_secret: "" }));
                try {
                  const statusRes = await fetch("/api/infinity/bridge/status");
                  if (statusRes.ok) setInfinityStatus(await statusRes.json());
                } catch {
                  // opcional
                }
              }}
            >
              Salvar Infinity
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Lembretes WhatsApp</CardTitle>
          <CardDescription>
            Horário do agendamento diário e janela de envio (horário de Brasília).
            A fila continua sendo processada a cada 5 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Hora do agendamento diário
              </label>
              <Input
                type="time"
                value={formatCronTimeValue(horaAgendamento, minutoAgendamento)}
                onChange={(e) => {
                  const { hour, minute } = parseCronTimeValue(e.target.value);
                  setCron({
                    ...cron,
                    hora_agendamento: hour,
                    minuto_agendamento: minute,
                  });
                }}
              />
              <p className="mt-1 text-xs text-slate-500">
                Quando o sistema monta a fila de lembretes (1x/dia). Equivale a{" "}
                {String(utcAgendamento.hour).padStart(2, "0")}:
                {String(utcAgendamento.minute).padStart(2, "0")} UTC no pg_cron.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Início da janela de envio
              </label>
              <Input
                type="time"
                value={formatCronTimeValue(janelaInicioH, janelaInicioM)}
                onChange={(e) => {
                  const { hour, minute } = parseCronTimeValue(e.target.value);
                  setCron({
                    ...cron,
                    janela_inicio: hour,
                    janela_inicio_minuto: minute,
                  });
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Fim da janela de envio
              </label>
              <Input
                type="time"
                value={formatCronTimeValue(janelaFimH, janelaFimM)}
                onChange={(e) => {
                  const { hour, minute } = parseCronTimeValue(e.target.value);
                  setCron({
                    ...cron,
                    janela_fim: hour,
                    janela_fim_minuto: minute,
                  });
                }}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Lembretes: 3 dias antes, no dia, 1 dia após e 7 dias após o vencimento
            (somente cobranças pendentes/vencidas). Use &quot;Executar agora&quot; para
            testar sem esperar o horário configurado.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} onClick={salvarCron}>
              Salvar horários
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={runningReminders || loading}
              onClick={executarLembretesAgora}
            >
              {runningReminders ? "Executando..." : "Executar lembretes agora"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
