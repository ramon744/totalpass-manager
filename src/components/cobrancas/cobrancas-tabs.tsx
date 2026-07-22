"use client";

import { useState } from "react";
import { CobrancasList } from "@/components/cobrancas/cobrancas-list";
import { InfinityCobrancasList } from "@/components/cobrancas/infinity-cobrancas-list";
import type { Beneficiario, Cobranca } from "@/types/database";

type CobrancaComBeneficiario = Cobranca & {
  beneficiario: Beneficiario | Beneficiario[] | null;
};

export type InfinityInvoiceRow = {
  id: string;
  infinity_invoice_slug: string;
  status: string;
  amount: number | null;
  due_date: string | null;
  paid_at: string | null;
  description: string | null;
  notified_email: boolean | null;
  notified_whatsapp: boolean | null;
  synced_at: string;
};

export type InfinityCobrancaRow = {
  id: string;
  infinity_customer_id: string;
  infinity_subscription_slug: string | null;
  nome: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  payment_status: string;
  amount: number | null;
  due_date: string | null;
  paid_at: string | null;
  invoice_slug: string | null;
  invoice_description: string | null;
  notified_email: boolean | null;
  notified_whatsapp: boolean | null;
  last_notified_at: string | null;
  synced_at: string;
  beneficiario_id: string | null;
  beneficiario: {
    id: string;
    nome: string;
    cpf: string | null;
    status: string | null;
    gateway_pagamento: string | null;
  } | null;
  invoices: InfinityInvoiceRow[];
};

type Tab = "asaas" | "infinity";

export function CobrancasTabs({
  cobrancasAsaas,
  cobrancasInfinity,
}: {
  cobrancasAsaas: CobrancaComBeneficiario[];
  cobrancasInfinity: InfinityCobrancaRow[];
}) {
  const [tab, setTab] = useState<Tab>("asaas");

  const overdue = cobrancasInfinity.filter(
    (r) => r.payment_status === "overdue"
  ).length;
  const pending = cobrancasInfinity.filter(
    (r) => r.payment_status === "pending"
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("asaas")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "asaas"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Asaas ({cobrancasAsaas.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("infinity")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "infinity"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Infinity ({cobrancasInfinity.length}
          {overdue > 0 || pending > 0
            ? ` · ${overdue} atraso · ${pending} pend.`
            : ""}
          )
        </button>
      </div>

      {tab === "asaas" ? (
        <CobrancasList cobrancas={cobrancasAsaas} />
      ) : (
        <InfinityCobrancasList rows={cobrancasInfinity} />
      )}
    </div>
  );
}
