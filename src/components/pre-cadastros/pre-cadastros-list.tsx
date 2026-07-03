"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableScroll } from "@/components/ui/table-scroll";
import { formatCpf, formatPhone } from "@/lib/utils";
import {
  formatDataEtiquetaBr,
  vencimentoSugeridoFromDataEtiqueta,
} from "@/lib/pre-cadastro-match";
import type { PreCadastroWhatsapp } from "@/types/database";

type PreCadastroItem = PreCadastroWhatsapp & {
  beneficiario:
    | { id: string; nome: string; cpf: string }
    | { id: string; nome: string; cpf: string }[]
    | null;
};

type Pagination = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

interface Props {
  items: PreCadastroItem[];
  pagination: Pagination;
  q: string;
}

function buildUrl(page: number, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/pre-cadastros${qs ? `?${qs}` : ""}`;
}

function resolveBeneficiario(item: PreCadastroItem) {
  if (!item.beneficiario) return null;
  return Array.isArray(item.beneficiario)
    ? item.beneficiario[0] ?? null
    : item.beneficiario;
}

export function PreCadastrosList({ items, pagination, q: qInit }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(qInit);

  useEffect(() => {
    setQ(qInit);
  }, [qInit]);

  function aplicarBusca() {
    router.push(buildUrl(1, q.trim()));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
          <CardDescription>
            Nome, CPF, telefone ou e-mail. A lista é alimentada automaticamente
            pelo webhook quando uma etiqueta monitorada é aplicada no WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Buscar pré-cadastro..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicarBusca()}
              />
            </div>
            <Button type="button" onClick={aplicarBusca}>
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pré-cadastros ({pagination.total})</CardTitle>
          <CardDescription>
            Removidos automaticamente quando a etiqueta monitorada é retirada
            no WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhum pré-cadastro encontrado.
            </p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                    <th className="px-3 py-2 font-medium">Contato</th>
                    <th className="px-3 py-2 font-medium">CPF</th>
                    <th className="px-3 py-2 font-medium">E-mail</th>
                    <th className="px-3 py-2 font-medium">Etiquetas</th>
                    <th className="px-3 py-2 font-medium">Data etiqueta</th>
                    <th className="px-3 py-2 font-medium">Vencimento sugerido</th>
                    <th className="px-3 py-2 font-medium">Beneficiário</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const beneficiario = resolveBeneficiario(item);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-slate-100 dark:border-slate-800/80"
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium">{item.nome || "—"}</div>
                          <div className="text-xs text-slate-500">
                            {formatPhone(item.telefone)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {item.cpf ? formatCpf(item.cpf) : "—"}
                        </td>
                        <td className="px-3 py-3">{item.email || "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {item.etiquetas.map((etiqueta) => (
                              <Badge key={etiqueta} variant="secondary">
                                {etiqueta}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {formatDataEtiquetaBr(item.data_etiqueta)}
                        </td>
                        <td className="px-3 py-3">
                          {vencimentoSugeridoFromDataEtiqueta(item.data_etiqueta)}
                        </td>
                        <td className="px-3 py-3">
                          {beneficiario ? (
                            <div>
                              <div className="font-medium">{beneficiario.nome}</div>
                              <div className="text-xs text-emerald-600 dark:text-emerald-400">
                                Já cadastrado
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-500">Pendente</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}

          {pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm text-slate-500">
                Página {pagination.page} de {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() =>
                    router.push(buildUrl(pagination.page - 1, qInit))
                  }
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() =>
                    router.push(buildUrl(pagination.page + 1, qInit))
                  }
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
