"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCurrency,
  maskCurrencyInput,
  maskPhoneInput,
  parseCurrencyInput,
} from "@/lib/utils";
import { isValidPhone } from "@/lib/validators/phone";
import { resolveAssinaturaDefaults } from "@/lib/assinatura-defaults";
import {
  calculateDependentBilling,
  formatMoneyValue,
  isDependenteCobravelPorStatus,
} from "@/lib/dependent-billing";
import type { Beneficiario, Provedor } from "@/types/database";

export function AssinaturaFormDialog({
  open,
  onOpenChange,
  beneficiario,
  defaults,
  provedoresById,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiario?: Beneficiario;
  defaults: { valor: number; dia: number; descricao: string };
  provedoresById?: Map<string, Provedor>;
  onSuccess?: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [valor, setValor] = useState("");
  const [diaVencimento, setDiaVencimento] = useState(String(defaults.dia));
  const [descricao, setDescricao] = useState(defaults.descricao);
  const [dependentesCobrancaIds, setDependentesCobrancaIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const provedor = beneficiario?.provedor_id
    ? provedoresById?.get(beneficiario.provedor_id)
    : undefined;
  const dependentes = beneficiario?.dependentes ?? [];
  const dependentesCobraveis = useMemo(
    () => dependentes.filter(isDependenteCobravelPorStatus),
    [dependentes]
  );

  useEffect(() => {
    if (!open) return;
    const resolved = resolveAssinaturaDefaults(
      beneficiario,
      provedoresById ?? new Map(),
      defaults
    );
    setNome(beneficiario?.nome ?? "");
    setTelefone(maskPhoneInput(beneficiario?.telefone ?? ""));
    setValor(
      resolved.valor.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    setDiaVencimento(String(resolved.dia));
    setDescricao(resolved.descricao);
    setDependentesCobrancaIds(resolved.dependentesCobrancaIds ?? []);
  }, [open, beneficiario, defaults, provedoresById]);

  const dependentPreview = useMemo(() => {
    if (!beneficiario) return null;
    return calculateDependentBilling({
      titular: beneficiario,
      dependentes,
      provedor,
      defaults,
      dependentesCobrancaIds,
    });
  }, [beneficiario, dependentes, provedor, defaults, dependentesCobrancaIds]);

  useEffect(() => {
    if (!open || !dependentPreview?.cobrarDependentes) return;
    setValor(
      dependentPreview.valorTotal.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    setDescricao(dependentPreview.descricao);
  }, [open, dependentPreview]);

  function toggleDependente(id: string) {
    setDependentesCobrancaIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!beneficiario) return;

    const valorNumber = parseCurrencyInput(valor);
    const dia = Number(diaVencimento);

    if (!nome.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    if (valorNumber <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    if (dia < 1 || dia > 28) {
      toast.error("Dia de vencimento deve ser entre 1 e 28");
      return;
    }
    const telefoneDigits = telefone.replace(/\D/g, "");
    if (!telefoneDigits || !isValidPhone(telefoneDigits)) {
      toast.error("Informe um WhatsApp válido para criar a assinatura");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiarioIds: [beneficiario.id],
          nome: nome.trim(),
          telefone: telefoneDigits,
          valor: valorNumber,
          diaVencimento: dia,
          descricao,
          dependentesCobrancaIds,
        }),
      });
      const data = await res.json();
      const result = data.results?.[0];

      if (!res.ok || !result?.success) {
        throw new Error(result?.error ?? data.error ?? "Erro ao criar assinatura");
      }

      toast.success(`Assinatura criada para ${nome.trim()}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar assinatura");
    } finally {
      setLoading(false);
    }
  }

  const valorPreview = formatCurrency(parseCurrencyInput(valor));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar assinatura</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Cliente *</label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do cliente"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              WhatsApp *
            </label>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(maskPhoneInput(e.target.value))}
              placeholder="(00) 00000-0000"
              inputMode="numeric"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Obrigatório para criar assinatura. As cobranças serão enviadas para este número.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Valor mensal *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                R$
              </span>
              <Input
                className="pl-9"
                value={valor}
                onChange={(e) => setValor(maskCurrencyInput(e.target.value))}
                placeholder="0,00"
                inputMode="numeric"
                required
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">{valorPreview} por mês</p>
          </div>

          {dependentPreview?.cobrarDependentes && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium">Dependentes na cobrança</p>
              <p className="mt-1 text-xs text-slate-500">
                Somente ativos/elegíveis entram no cálculo. Desmarque quem não deve
                ser cobrado.
              </p>
              <div className="mt-3 space-y-2">
                {dependentesCobraveis.length > 0 ? (
                  dependentesCobraveis.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900"
                    >
                      <span>
                        <input
                          type="checkbox"
                          className="mr-2"
                          checked={dependentesCobrancaIds.includes(d.id)}
                          onChange={() => toggleDependente(d.id)}
                        />
                        {d.nome} ({d.status_totalpass})
                      </span>
                      <span className="text-xs text-slate-500">
                        R$ {formatMoneyValue(dependentPreview.valorDependente)}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">
                    Nenhum dependente ativo/elegível para cobrar.
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300">
                Titular R$ {formatMoneyValue(dependentPreview.valorTitular)} +
                dependentes R$ {formatMoneyValue(dependentPreview.valorDependentes)}
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Dia de vencimento *</label>
            <Input
              type="number"
              min={1}
              max={28}
              value={diaVencimento}
              onChange={(e) => setDiaVencimento(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Todo dia {diaVencimento || "?"} de cada mês.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !beneficiario}>
            {loading ? "Criando..." : "Confirmar assinatura"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
