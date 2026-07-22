"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatCpf, formatPhone } from "@/lib/utils";
import type {
  WhatsappAuditGrupo,
  WhatsappAuditItem,
  WhatsappAuditMatchPor,
  WhatsappAuditResult,
} from "@/lib/services/whatsapp-audit";

type FiltroGrupo = "todos" | WhatsappAuditGrupo;
type FiltroEtiqueta = "todas" | "totalpass" | "gympass" | "cancelado";

const grupoLabel: Record<WhatsappAuditGrupo, string> = {
  bate: "Bate",
  so_whatsapp: "Só WhatsApp",
  so_manager: "Só Manager",
};

const grupoVariant: Record<
  WhatsappAuditGrupo,
  "success" | "warning" | "danger" | "default"
> = {
  bate: "success",
  so_whatsapp: "warning",
  so_manager: "danger",
};

const matchPorLabel: Record<WhatsappAuditMatchPor, string> = {
  manager_phone: "Tel. Manager",
  infinity_phone: "Tel. Infinity",
  email: "E-mail",
  cpf: "CPF",
};

function formatTel(value: string | null | undefined) {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  // ID LID / número interno — não formatar como celular BR
  if (
    digits.length > 13 ||
    !(
      digits.length === 10 ||
      digits.length === 11 ||
      (digits.startsWith("55") &&
        (digits.length === 12 || digits.length === 13))
    )
  ) {
    return "—";
  }
  const local =
    digits.startsWith("55") && digits.length >= 12
      ? digits.slice(2)
      : digits;
  return formatPhone(local) === "-" ? "—" : formatPhone(local);
}

function TelefoneCell({
  telefone,
  oculto,
}: {
  telefone: string | null | undefined;
  oculto?: boolean;
}) {
  if (oculto) {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-300">
        Telefone oculto (WhatsApp LID)
      </span>
    );
  }
  if (!telefone) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <CopyableValue
      value={telefone}
      display={formatTel(telefone)}
      mode="phone"
    />
  );
}

function TelefonesAuditCell({ item }: { item: WhatsappAuditItem }) {
  const hasManager = Boolean(item.beneficiario_telefone);
  const hasInfinity = Boolean(item.infinity_telefone);

  if (item.grupo === "so_whatsapp") {
    return (
      <TelefoneCell telefone={item.wa_telefone} oculto={item.telefone_oculto} />
    );
  }

  if (!hasManager && !hasInfinity) {
    return (
      <TelefoneCell telefone={item.wa_telefone} oculto={item.telefone_oculto} />
    );
  }

  return (
    <div className="space-y-1 text-xs">
      {hasManager ? (
        <div>
          <span className="text-slate-400">Manager · </span>
          <CopyableValue
            value={item.beneficiario_telefone}
            display={formatTel(item.beneficiario_telefone)}
            mode="phone"
          />
        </div>
      ) : (
        <div className="text-slate-400">Manager · —</div>
      )}
      {hasInfinity ? (
        <div>
          <span className="text-slate-400">Infinity · </span>
          <CopyableValue
            value={item.infinity_telefone}
            display={formatTel(item.infinity_telefone)}
            mode="phone"
          />
        </div>
      ) : (
        <div className="text-slate-400">Infinity · —</div>
      )}
      {item.telefones_divergentes ? (
        <div className="text-amber-700 dark:text-amber-300">Divergentes</div>
      ) : null}
    </div>
  );
}

export function WhatsappAuditPanel() {
  const [data, setData] = useState<WhatsappAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtroGrupo, setFiltroGrupo] = useState<FiltroGrupo>("todos");
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<FiltroEtiqueta>("todas");
  const [q, setQ] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/audit");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha na auditoria");
      setData(json as WhatsappAuditResult);
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
    if (!data) return [] as WhatsappAuditItem[];
    const query = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");

    return data.itens.filter((item) => {
      if (filtroGrupo !== "todos" && item.grupo !== filtroGrupo) return false;

      if (filtroEtiqueta === "totalpass" && !item.tipos.includes("totalpass")) {
        return false;
      }
      if (filtroEtiqueta === "gympass" && !item.tipos.includes("gympass")) {
        return false;
      }
      if (filtroEtiqueta === "cancelado" && !item.tem_cancelado) return false;

      if (!query && !digits) return true;

      const hay = [
        item.beneficiario_nome,
        item.wa_nome,
        item.beneficiario_cpf,
        item.beneficiario_telefone,
        item.infinity_telefone,
        item.beneficiario_email,
        item.wa_telefone,
        item.match_por ? matchPorLabel[item.match_por] : null,
        ...(item.etiquetas || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && hay.includes(query)) return true;
      if (digits && hay.replace(/\D/g, "").includes(digits)) return true;
      return false;
    });
  }, [data, filtroGrupo, filtroEtiqueta, q]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Auditoria WhatsApp ↔ Manager</CardTitle>
            <CardDescription>
              Cruza chats com etiqueta <strong>Cliente TotalPass</strong> ou{" "}
              <strong>Cliente Gympass</strong> (mesmo com CANCELADO junto) com
              telefone do Manager, WhatsApp da Infinity e e-mail. Pode levar
              alguns segundos.
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
                title="Batem"
                value={data.resumo.bate}
                hint="Etiqueta WA + identidade (tel./e-mail)"
              />
              <ResumoCard
                title="Só WhatsApp"
                value={data.resumo.so_whatsapp}
                hint="Tem etiqueta, sem match no cadastro"
              />
              <ResumoCard
                title="Só Manager"
                value={data.resumo.so_manager}
                hint="Titular ativo/elegível sem etiqueta WA"
              />
              <ResumoCard
                title="WA TotalPass"
                value={data.resumo.totalpass_wa}
                hint={`Gympass: ${data.resumo.gympass_wa} · +CANCELADO: ${data.resumo.totalpass_com_cancelado}`}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {loading
                ? "Carregando chats e etiquetas da Uazapi…"
                : "Clique em Atualizar para gerar o relatório."}
            </p>
          )}

          {data && (
            <p className="text-xs text-slate-500">
              {data.chats_analisados} chats analisados · etiquetas alvo:{" "}
              {data.etiquetas_alvo.join(", ")} · gerado em{" "}
              {new Date(data.gerado_em).toLocaleString("pt-BR")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultados</CardTitle>
          <CardDescription>
            Filtre por grupo, etiqueta ou busque por nome, telefone Manager/Infinity, e-mail ou CPF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Buscar nome, tel. Manager/Infinity, e-mail ou CPF…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["todos", "Todos"],
                ["bate", "Batem"],
                ["so_whatsapp", "Só WhatsApp"],
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
                  ? ` (${data.resumo[id as WhatsappAuditGrupo]})`
                  : ""}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["todas", "Todas etiquetas"],
                ["totalpass", "Cliente TotalPass"],
                ["gympass", "Cliente Gympass"],
                ["cancelado", "Com CANCELADO"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={filtroEtiqueta === id ? "default" : "outline"}
                onClick={() => setFiltroEtiqueta(id)}
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
            </p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                    <th className="px-3 py-2 font-medium">Grupo</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">Manager</th>
                    <th className="px-3 py-2 font-medium">Telefones</th>
                    <th className="px-3 py-2 font-medium">Match</th>
                    <th className="px-3 py-2 font-medium">Etiquetas</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item, idx) => (
                    <tr
                      key={`${item.grupo}-${item.beneficiario_id ?? item.wa_chat_id ?? item.wa_telefone}-${idx}`}
                      className="border-b border-slate-100 dark:border-slate-900"
                    >
                      <td className="px-3 py-2">
                        <Badge variant={grupoVariant[item.grupo]}>
                          {grupoLabel[item.grupo]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          <CopyableValue value={item.wa_nome} mode="nome" />
                        </div>
                        {item.grupo !== "so_manager" &&
                        item.wa_telefone &&
                        !item.telefone_oculto ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.wa_telefone}
                              display={formatTel(item.wa_telefone)}
                              mode="phone"
                            />
                          </div>
                        ) : null}
                        {item.grupo !== "so_manager" &&
                        item.telefone_oculto &&
                        !item.wa_nome ? (
                          <div className="text-xs text-slate-500">
                            Contato sem nome salvo
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          <CopyableValue
                            value={item.beneficiario_nome}
                            mode="nome"
                          />
                        </div>
                        {item.beneficiario_cpf ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.beneficiario_cpf}
                              display={
                                <>
                                  {formatCpf(item.beneficiario_cpf)}
                                  {item.beneficiario_perfil
                                    ? ` · ${item.beneficiario_perfil}`
                                    : ""}
                                </>
                              }
                              mode="cpf"
                            />
                          </div>
                        ) : null}
                        {item.beneficiario_email ? (
                          <div className="text-xs text-slate-500">
                            <CopyableValue
                              value={item.beneficiario_email}
                              mode="email"
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <TelefonesAuditCell item={item} />
                      </td>
                      <td className="px-3 py-2">
                        {item.match_por ? (
                          <div className="space-y-1">
                            <Badge variant="info">
                              {matchPorLabel[item.match_por]}
                            </Badge>
                            {item.telefones_divergentes ? (
                              <p className="text-xs text-amber-700 dark:text-amber-300">
                                Manager ≠ Infinity
                              </p>
                            ) : null}
                          </div>
                        ) : item.telefones_divergentes ? (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Manager ≠ Infinity
                          </p>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {item.etiquetas.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            item.etiquetas.map((et) => (
                              <Badge
                                key={et}
                                variant={
                                  /cancelado/i.test(et)
                                    ? "danger"
                                    : /gympass/i.test(et)
                                      ? "info"
                                      : "default"
                                }
                              >
                                {et}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {item.beneficiario_status ? (
                          <Badge
                            variant={
                              item.beneficiario_status === "ativo"
                                ? "success"
                                : item.beneficiario_status === "elegivel"
                                  ? "warning"
                                  : "default"
                            }
                          >
                            {item.beneficiario_status}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}

          {data && (
            <p className="text-xs text-slate-500">
              Exibindo {filtrados.length} de {data.itens.length} itens
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
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
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
