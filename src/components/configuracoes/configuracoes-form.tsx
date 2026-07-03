"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ConfigAsaas,
  ConfigCron,
  ConfigEmpresa,
  ConfigFinanceiro,
  ConfigUazapi,
} from "@/types/database";
import { DEFAULT_CRON_CONFIG } from "@/types/database";
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

interface Props {
  empresa: ConfigEmpresa;
  financeiro: ConfigFinanceiro;
  asaas: ConfigAsaas;
  uazapi: ConfigUazapi;
  cron: ConfigCron;
}

export function ConfiguracoesForm({
  empresa: empresaInit,
  financeiro: financeiroInit,
  asaas: asaasInit,
  uazapi: uazapiInit,
  cron: cronInit,
}: Props) {
  const [empresa, setEmpresa] = useState(empresaInit);
  const [financeiro, setFinanceiro] = useState(financeiroInit);
  const [asaas, setAsaas] = useState(asaasInit);
  const [uazapi, setUazapi] = useState(uazapiInit);
  const [cron, setCron] = useState(cronInit);
  const [loading, setLoading] = useState(false);
  const [runningReminders, setRunningReminders] = useState(false);

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
