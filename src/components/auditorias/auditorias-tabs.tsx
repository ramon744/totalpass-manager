"use client";

import { useState } from "react";
import { ClientesAuditPanel } from "@/components/clientes-audit/clientes-audit-panel";
import { WhatsappAuditPanel } from "@/components/whatsapp-audit/whatsapp-audit-panel";

type AuditoriaTab = "clientes" | "whatsapp";

export function AuditoriasTabs() {
  const [tab, setTab] = useState<AuditoriaTab>("clientes");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("clientes")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "clientes"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          Clientes Infinity
        </button>
        <button
          type="button"
          onClick={() => setTab("whatsapp")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            tab === "whatsapp"
              ? "bg-emerald-600 text-white"
              : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          WhatsApp
        </button>
      </div>

      {tab === "clientes" ? <ClientesAuditPanel /> : <WhatsappAuditPanel />}
    </div>
  );
}
