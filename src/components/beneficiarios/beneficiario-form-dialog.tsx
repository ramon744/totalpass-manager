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
import type {
  Beneficiario,
  PerfilBeneficiario,
  Provedor,
  StatusTotalpass,
} from "@/types/database";
import { maskCpfInput, maskPhoneInput } from "@/lib/utils";

export type BeneficiarioFormMode =
  | "create_titular"
  | "create_dependente"
  | "edit";

interface FormState {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  perfil: PerfilBeneficiario;
  provedor_id: string;
  status_totalpass: StatusTotalpass;
  plano: string;
  data_aderido_totalpass: string;
  observacoes: string;
}

const emptyForm = (): FormState => ({
  nome: "",
  cpf: "",
  telefone: "",
  email: "",
  perfil: "titular",
  provedor_id: "",
  status_totalpass: "ativo",
  plano: "",
  data_aderido_totalpass: "",
  observacoes: "",
});

function fromBeneficiario(b: Beneficiario): FormState {
  return {
    nome: b.nome,
    cpf: maskCpfInput(b.cpf),
    telefone: b.telefone ? maskPhoneInput(b.telefone) : "",
    email: b.email ?? "",
    perfil: b.perfil,
    provedor_id: b.provedor_id ?? "",
    status_totalpass: b.status_totalpass,
    plano: b.plano ?? "",
    data_aderido_totalpass: b.data_aderido_totalpass ?? "",
    observacoes: b.observacoes ?? "",
  };
}

export function BeneficiarioFormDialog({
  open,
  onOpenChange,
  mode,
  beneficiario,
  titularId,
  titularNome,
  titularProvedorId,
  provedores = [],
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BeneficiarioFormMode;
  beneficiario?: Beneficiario;
  titularId?: string;
  titularNome?: string;
  titularProvedorId?: string | null;
  provedores: Provedor[];
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);

  const isEdit = mode === "edit";
  const isDependente = mode === "create_dependente" || form.perfil === "dependente";

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && beneficiario) {
      setForm(fromBeneficiario(beneficiario));
    } else if (mode === "create_dependente") {
      setForm({
        ...emptyForm(),
        perfil: "dependente",
        provedor_id: titularProvedorId ?? "",
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, mode, beneficiario, titularProvedorId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      nome: form.nome,
      cpf: form.cpf,
      telefone: form.telefone || null,
      email: form.email || null,
      perfil: isDependente ? ("dependente" as const) : ("titular" as const),
      titular_id: isDependente ? titularId ?? beneficiario?.titular_id : null,
      provedor_id: form.provedor_id || null,
      status_totalpass: form.status_totalpass,
      plano: form.plano || null,
      data_aderido_totalpass: form.data_aderido_totalpass || null,
      observacoes: form.observacoes || null,
    };

    try {
      const url = isEdit
        ? `/api/beneficiarios/${beneficiario!.id}`
        : "/api/beneficiarios";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");

      toast.success(isEdit ? "Beneficiário atualizado" : "Beneficiário cadastrado");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "edit"
      ? "Editar beneficiário"
      : mode === "create_dependente"
        ? `Adicionar dependente${titularNome ? ` — ${titularNome}` : ""}`
        : "Novo titular";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome *</label>
            <Input
              value={form.nome}
              onChange={(e) => updateField("nome", e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">CPF *</label>
            <Input
              value={form.cpf}
              onChange={(e) => updateField("cpf", maskCpfInput(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              maxLength={14}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Provedor *</label>
            <select
              className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              value={form.provedor_id}
              onChange={(e) => updateField("provedor_id", e.target.value)}
              required
              disabled={mode === "create_dependente" && Boolean(titularProvedorId)}
            >
              <option value="">Selecione um provedor</option>
              {provedores.map((provedor) => (
                <option key={provedor.id} value={provedor.id}>
                  {provedor.nome}
                </option>
              ))}
            </select>
            {mode === "create_dependente" && titularProvedorId && (
              <p className="mt-1 text-xs text-slate-500">
                Dependentes herdam o provedor do titular.
              </p>
            )}
            {provedores.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Cadastre um provedor antes de adicionar beneficiários.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Telefone</label>
              <Input
                value={form.telefone}
                onChange={(e) => updateField("telefone", maskPhoneInput(e.target.value))}
                placeholder="(00) 00000-0000"
                inputMode="numeric"
                maxLength={15}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">E-mail</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Status TotalPass</label>
              <select
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={form.status_totalpass}
                onChange={(e) =>
                  updateField("status_totalpass", e.target.value as StatusTotalpass)
                }
              >
                <option value="ativo">Ativo</option>
                <option value="elegivel">Elegível</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Plano</label>
              <Input
                value={form.plano}
                onChange={(e) => updateField("plano", e.target.value)}
                placeholder="Ex: TP 4"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Aderido em (apenas consulta)
            </label>
            <Input
              type="date"
              value={form.data_aderido_totalpass}
              onChange={(e) => updateField("data_aderido_totalpass", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Observações</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              rows={3}
              value={form.observacoes}
              onChange={(e) => updateField("observacoes", e.target.value)}
            />
          </div>

          {isDependente && (
            <p className="text-xs text-slate-500">
              Este cadastro será vinculado como dependente do titular selecionado.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
