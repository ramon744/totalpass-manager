"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableScroll } from "@/components/ui/table-scroll";
import { CopyableValue } from "@/components/ui/copyable-value";
import { formatInfinityPaymentStatus } from "@/lib/infinity-payment-status";
import { formatCpf, formatPhone } from "@/lib/utils";
import type {
  ClientesAuditGrupo,
  ClientesAuditItem,
  ClientesAuditResult,
} from "@/lib/services/clientes-audit";

type FiltroGrupo = "todos" | ClientesAuditGrupo;
type FiltroStatus =
  | "todos"
  | "overdue"
  | "pending"
  | "paid"
  | "unknown"
  | "inactive";

const grupoLabel: Record<ClientesAuditGrupo, string> = {
  bate: "No Manager",
  so_infinity: "Só Infinity",
  so_manager: "Só Manager",
};

const grupoVariant: Record<
  ClientesAuditGrupo,
  "success" | "warning" | "info"
> = {
  bate: "success",
  so_infinity: "warning",
  so_manager: "info",
};

function formatTel(value: string | null | undefined) {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  const local =
    digits.startsWith("55") && digits.length >= 12
      ? digits.slice(2)
      : digits;
  return formatPhone(local) === "-" ? value : formatPhone(local);
}

function ResumoCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export function ClientesAuditPanel() {
  const [data, setData] = useState<ClientesAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtroGrupo, setFiltroGrupo] = useState<FiltroGrupo>("todos");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [q, setQ] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clientes/audit");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha na auditoria");
      setData(json as ClientesAuditResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na auditoria");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    if (!data) return [] as ClientesAuditItem[];
    const query = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");

    return data.itens.filter((item) => {
      if (filtroGrupo !== "todos" && item.grupo !== filtroGrupo) return false;
      if (
        filtroStatus !== "todos" &&
        (item.payment_status || "") !== filtroStatus
      ) {
        return false;
      }

      if (!query && !digits) return true;

      const hay = [
        item.infinity_nome,
        item.beneficiario_nome,
        item.infinity_cpf,
        item.beneficiario_cpf,
        item.infinity_email,
        item.infinity_phone,
        item.sugestao,
        item.wa_nome,
        item.provedor_nome,
        ...(item.wa_etiquetas || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && hay.includes(query)) return true;
      if (digits && hay.replace(/\D/g, "").includes(digits)) return true;
      return false;
    });
  }, [data, filtroGrupo, filtroStatus, q]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Auditoria Clientes Infinity ↔ TotalPass</CardTitle>
            <CardDescription>
              Cruza o último sync da extensão Infinity com titulares do Manager
              (CPF). Quem está na Infinity e <strong>não</strong> no seu
              TotalPass tende a ser do amigo ou Gympass — use para decidir sem
              desvincular à toa.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void carregar()}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Consultando…" : "Atualizar agora"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {data ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ResumoCard
                title="Infinity (sync)"
                value={data.resumo.infinity_total}
                hint={`pago ${data.resumo.paid} · pendente ${data.resumo.pending} · em atraso ${data.resumo.overdue}`}
              />
              <ResumoCard
                title="No Manager"
                value={data.resumo.bate}
                hint="CPF na Infinity e no Manager"
              />
              <ResumoCard
                title="Só Infinity"
                value={data.resumo.so_infinity}
                hint="Não cadastrado no Manager"
              />
              <ResumoCard
                title="Só Manager"
                value={data.resumo.so_manager}
                hint={`Titulares no Manager: ${data.resumo.manager_titulares}`}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {loading
                ? "Carregando sync Infinity × Manager…"
                : "Clique em Atualizar para gerar o relatório."}
            </p>
          )}

          {data && (
            <p className="text-xs text-slate-500">
              Fonte: {data.fonte} · gerado em{" "}
              {new Date(data.gerado_em).toLocaleString("pt-BR")} · sincronize
              todos os clientes na extensão (v0.1.4+) para números completos.{" "}
              <Link
                href="/configuracoes"
                className="underline-offset-2 hover:underline"
              >
                Ver status Infinity
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultados — clientes</CardTitle>
          <CardDescription>
            Foque em “Só Infinity” para quem ainda não está no Manager. Nome,
            etiquetas WhatsApp e provedor aparecem quando houver match.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar nome, CPF, e-mail, telefone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["todos", "Todos"],
                ["so_infinity", "Só Infinity"],
                ["bate", "No Manager"],
                ["so_manager", "Só Manager"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={filtroGrupo === id ? "default" : "outline"}
                onClick={() => setFiltroGrupo(id)}
              >
                {label}
                {data && id !== "todos"
                  ? ` (${data.resumo[id as ClientesAuditGrupo]})`
                  : data
                    ? ` (${data.itens.length})`
                    : ""}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["todos", "Todos status"],
                ["overdue", "Em atraso"],
                ["pending", "Pendente"],
                ["paid", "Pago"],
                ["unknown", "Sem fatura"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={filtroStatus === id ? "default" : "outline"}
                onClick={() => setFiltroStatus(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          {!data && loading ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Carregando…
            </p>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhum resultado com os filtros atuais.
              {!data?.resumo.infinity_total
                ? " Rode o sync completo na extensão Infinity primeiro."
                : ""}
            </p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                    <th className="px-3 py-2 font-medium">Grupo</th>
                    <th className="px-3 py-2 font-medium">Infinity</th>
                    <th className="px-3 py-2 font-medium">Manager</th>
                    <th className="px-3 py-2 font-medium">Fatura</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">Sugestão</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item, idx) => (
                    <tr
                      key={`${item.grupo}-${item.infinity_customer_id ?? item.beneficiario_id}-${idx}`}
                      className="border-b border-slate-100 dark:border-slate-900"
                    >
                      <td className="px-3 py-2">
                        <Badge variant={grupoVariant[item.grupo]}>
                          {grupoLabel[item.grupo]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {item.infinity_nome ? (
                          <div className="font-medium">
                            <CopyableValue
                              value={item.infinity_nome}
                              mode="nome"
                            />
                          </div>
                        ) : null}
                        {item.infinity_cpf ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.infinity_cpf}
                              display={formatCpf(item.infinity_cpf)}
                              mode="cpf"
                            />
                          </div>
                        ) : null}
                        {item.infinity_email ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.infinity_email}
                              mode="email"
                            />
                          </div>
                        ) : null}
                        {item.infinity_phone ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.infinity_phone}
                              display={formatTel(item.infinity_phone)}
                              mode="phone"
                            />
                          </div>
                        ) : null}
                        {!item.infinity_nome &&
                        !item.infinity_cpf &&
                        !item.infinity_email &&
                        !item.infinity_phone ? (
                          <span className="text-slate-400">—</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {item.beneficiario_id ? (
                          <div className="font-medium">
                            <CopyableValue
                              value={item.beneficiario_nome}
                              display={
                                <Link
                                  href={`/beneficiarios?q=${encodeURIComponent(
                                    item.beneficiario_nome ||
                                      item.beneficiario_cpf ||
                                      ""
                                  )}`}
                                  className="underline-offset-2 hover:underline"
                                >
                                  {item.beneficiario_nome || "—"}
                                </Link>
                              }
                              mode="nome"
                            />
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {item.beneficiario_cpf && (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.beneficiario_cpf}
                              display={formatCpf(item.beneficiario_cpf)}
                              mode="cpf"
                            />
                          </div>
                        )}
                        {item.beneficiario_status && (
                          <div className="text-xs text-slate-500">
                            {[
                              item.beneficiario_status,
                              item.gateway_pagamento,
                              item.provedor_nome,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                        {!item.beneficiario_status && item.provedor_nome ? (
                          <div className="text-xs text-slate-500">
                            {item.provedor_nome}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {item.payment_status ? (
                          <Badge
                            variant={
                              item.payment_status === "overdue"
                                ? "danger"
                                : item.payment_status === "pending"
                                  ? "warning"
                                  : item.payment_status === "paid"
                                    ? "success"
                                    : "default"
                            }
                          >
                            {formatInfinityPaymentStatus(item.payment_status)}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          {item.wa_nome ? (
                            <div className="font-medium">
                              <CopyableValue value={item.wa_nome} mode="nome" />
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-1">
                            {item.wa_etiquetas.length === 0 ? (
                              !item.wa_nome ? (
                                <span className="text-slate-400">—</span>
                              ) : null
                            ) : (
                              item.wa_etiquetas.map((et) => (
                                <Badge key={et} variant="default">
                                  {et}
                                </Badge>
                              ))
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[260px] px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                        {item.sugestao}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
