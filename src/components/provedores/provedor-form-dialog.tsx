"use client";

import { useEffect, useState } from "react";
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
  parseCurrencyInput,
} from "@/lib/utils";
import type { Provedor } from "@/types/database";

interface FormState {
  nome: string;
  beneficio: string;
  custo_colaborador: string;
  valor_cobrado_mensal: string;
  cobrar_dependentes: boolean;
  valor_dependente: string;
  mensagem_padrao: string;
  dia_pagamento: string;
}

const emptyForm = (): FormState => ({
  nome: "",
  beneficio: "",
  custo_colaborador: "",
  valor_cobrado_mensal: "",
  cobrar_dependentes: false,
  valor_dependente: "",
  mensagem_padrao: "",
  dia_pagamento: "",
});

function formatCurrencyField(value: number | null) {
  if (value == null) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fromProvedor(p: Provedor): FormState {
  return {
    nome: p.nome,
    beneficio: p.beneficio ?? "",
    custo_colaborador: formatCurrencyField(p.custo_colaborador),
    valor_cobrado_mensal: formatCurrencyField(p.valor_cobrado_mensal),
    cobrar_dependentes: Boolean(p.cobrar_dependentes),
    valor_dependente: formatCurrencyField(p.valor_dependente),
    mensagem_padrao: p.mensagem_padrao ?? "",
    dia_pagamento: p.dia_pagamento != null ? String(p.dia_pagamento) : "",
  };
}

export function ProvedorFormDialog({
  open,
  onOpenChange,
  provedor,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provedor?: Provedor;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const isEdit = Boolean(provedor);

  useEffect(() => {
    if (!open) return;
    setForm(provedor ? fromProvedor(provedor) : emptyForm());
  }, [open, provedor]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      nome: form.nome,
      beneficio: form.beneficio,
      custo_colaborador: parseCurrencyInput(form.custo_colaborador),
      valor_cobrado_mensal: parseCurrencyInput(form.valor_cobrado_mensal),
      cobrar_dependentes: form.cobrar_dependentes,
      valor_dependente: (() => {
        const parsed = parseCurrencyInput(form.valor_dependente);
        if (parsed > 0) return parsed;
        if (!form.cobrar_dependentes && provedor?.valor_dependente) {
          return Number(provedor.valor_dependente);
        }
        return form.cobrar_dependentes ? null : null;
      })(),
      mensagem_padrao: form.mensagem_padrao,
      dia_pagamento: Number(form.dia_pagamento),
    };

    try {
      const url = isEdit ? `/api/provedores/${provedor!.id}` : "/api/provedores";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");

      toast.success(isEdit ? "Provedor atualizado" : "Provedor cadastrado");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  const custoPreview = formatCurrency(parseCurrencyInput(form.custo_colaborador));
  const valorClientePreview = formatCurrency(
    parseCurrencyInput(form.valor_cobrado_mensal)
  );
  const valorDependentePreview = formatCurrency(parseCurrencyInput(form.valor_dependente));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar provedor" : "Novo provedor"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome da empresa *</label>
            <Input
              value={form.nome}
              onChange={(e) => updateField("nome", e.target.value)}
              placeholder="Ex: 60051049 RAMON ROMULO SOUZA DA SILVA"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Deve ser exatamente igual ao nome na planilha do TotalPass.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Benefício fornecido *</label>
            <Input
              value={form.beneficio}
              onChange={(e) => updateField("beneficio", e.target.value)}
              placeholder="Ex: TotalPass TP 4"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Custo por colaborador cadastrado *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                R$
              </span>
              <Input
                className="pl-9"
                value={form.custo_colaborador}
                onChange={(e) =>
                  updateField("custo_colaborador", maskCurrencyInput(e.target.value))
                }
                placeholder="0,00"
                inputMode="numeric"
                required
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">{custoPreview} por colaborador</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Valor cobrado mensal do cliente *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                R$
              </span>
              <Input
                className="pl-9"
                value={form.valor_cobrado_mensal}
                onChange={(e) =>
                  updateField("valor_cobrado_mensal", maskCurrencyInput(e.target.value))
                }
                placeholder="0,00"
                inputMode="numeric"
                required
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {valorClientePreview} por titular — usado ao criar assinaturas dos
              beneficiários vinculados.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.cobrar_dependentes}
                onChange={(e) => updateField("cobrar_dependentes", e.target.checked)}
              />
              Cobrar dependentes deste provedor
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Quando ativo, novos dependentes podem entrar na cobrança automaticamente.
              Titulares que já cobram dependentes continuam mesmo com esta opção desligada.
            </p>
            {(form.cobrar_dependentes || form.valor_dependente.trim()) && (
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">
                  Valor por dependente {form.cobrar_dependentes ? "*" : ""}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                    R$
                  </span>
                  <Input
                    className="pl-9"
                    value={form.valor_dependente}
                    onChange={(e) =>
                      updateField("valor_dependente", maskCurrencyInput(e.target.value))
                    }
                    placeholder="0,00"
                    inputMode="numeric"
                    required={form.cobrar_dependentes}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {valorDependentePreview} por dependente cobrado.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Mensagem padrão *</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              rows={3}
              value={form.mensagem_padrao}
              onChange={(e) => updateField("mensagem_padrao", e.target.value)}
              placeholder="Ex: Mensalidade TotalPass — empresa X"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Descrição padrão da cobrança para os titulares deste provedor (pode
              ser editada ao gerar a assinatura).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Dia de pagamento da fatura *
            </label>
            <Input
              type="number"
              min={1}
              max={28}
              value={form.dia_pagamento}
              onChange={(e) => updateField("dia_pagamento", e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Dia {form.dia_pagamento || "?"} de cada mês para pagar a fatura do provedor.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : isEdit ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
