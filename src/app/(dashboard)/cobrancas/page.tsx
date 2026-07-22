import { DashboardShell } from "@/components/layout/dashboard-shell";
import { CobrancasTabs } from "@/components/cobrancas/cobrancas-tabs";
import type { InfinityCobrancaRow } from "@/components/cobrancas/cobrancas-tabs";
import { DesvinculosPendentesPanel } from "@/components/cobrancas/desvinculos-pendentes-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { listDesvinculosPendentesManuais } from "@/lib/services/overdue-inactivation";

/**
 * Lista Cobranças Asaas + snapshot Infinity (só leitura do sync).
 * Não cria fatura nem notifica beneficiários.
 */
export default async function CobrancasPage() {
  const supabase = await createClient();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  const { data: cobrancas } = await supabase
    .from("cobrancas")
    .select("*, beneficiario:beneficiarios(*)")
    .order("vencimento", { ascending: false });

  const {
    data: infinityRaw,
    error: infinityErr,
  } = await service
    .from("infinity_customer_status")
    .select(
      "id, infinity_customer_id, infinity_subscription_slug, nome, document_number, email, phone, payment_status, amount, due_date, paid_at, invoice_slug, invoice_description, notified_email, notified_whatsapp, last_notified_at, synced_at, beneficiario_id"
    )
    .order("synced_at", { ascending: false })
    .limit(500);

  const customerIds = (infinityRaw ?? []).map((r) => r.infinity_customer_id);
  const { data: invoiceRows } = customerIds.length
    ? await service
        .from("infinity_invoices")
        .select(
          "id, infinity_invoice_slug, infinity_customer_id, status, amount, due_date, paid_at, description, notified_email, notified_whatsapp, synced_at"
        )
        .in("infinity_customer_id", customerIds)
        .order("due_date", { ascending: false })
        .limit(1000)
    : { data: [] as never[] };

  const invoicesByCustomer = new Map<string, typeof invoiceRows>();
  const subByCustomer = new Map<string, string | null>();
  for (const r of infinityRaw ?? []) {
    subByCustomer.set(
      r.infinity_customer_id,
      (r.infinity_subscription_slug as string | null) ?? null
    );
  }
  for (const inv of invoiceRows ?? []) {
    const slug = String(inv.infinity_invoice_slug || "");
    const sub = subByCustomer.get(inv.infinity_customer_id) || null;
    // Esconde fantasmas do parser antigo (syn-* / slug de assinatura)
    if (slug.startsWith("syn-")) continue;
    if (sub && slug === sub) continue;
    const list = invoicesByCustomer.get(inv.infinity_customer_id) ?? [];
    list.push(inv);
    invoicesByCustomer.set(inv.infinity_customer_id, list);
  }

  const benIds = [
    ...new Set(
      (infinityRaw ?? [])
        .map((r) => r.beneficiario_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const beneficiariosById = new Map<
    string,
    {
      id: string;
      nome: string;
      cpf: string | null;
      status: string | null;
      gateway_pagamento: string | null;
    }
  >();

  if (benIds.length) {
    const { data: bens } = await service
      .from("beneficiarios")
      .select("id, nome, cpf, status, gateway_pagamento")
      .in("id", benIds);
    for (const b of bens ?? []) {
      beneficiariosById.set(b.id, b);
    }
  }

  const infinityNormalized: InfinityCobrancaRow[] = (infinityRaw ?? []).map(
    (row) => ({
      id: row.id,
      infinity_customer_id: row.infinity_customer_id,
      infinity_subscription_slug: row.infinity_subscription_slug,
      nome: row.nome,
      document_number: row.document_number,
      email: row.email,
      phone: row.phone,
      payment_status: row.payment_status,
      amount: row.amount != null ? Number(row.amount) : null,
      due_date: row.due_date,
      paid_at: row.paid_at ?? null,
      invoice_slug: row.invoice_slug ?? null,
      invoice_description: row.invoice_description ?? null,
      notified_email: row.notified_email ?? null,
      notified_whatsapp: row.notified_whatsapp ?? null,
      last_notified_at: row.last_notified_at ?? null,
      synced_at: row.synced_at,
      beneficiario_id: row.beneficiario_id,
      beneficiario: row.beneficiario_id
        ? beneficiariosById.get(row.beneficiario_id) ?? null
        : null,
      invoices: (invoicesByCustomer.get(row.infinity_customer_id) ?? []).map(
        (inv) => ({
          id: inv.id,
          infinity_invoice_slug: inv.infinity_invoice_slug,
          status: inv.status,
          amount: inv.amount != null ? Number(inv.amount) : null,
          due_date: inv.due_date,
          paid_at: inv.paid_at,
          description: inv.description,
          notified_email: inv.notified_email,
          notified_whatsapp: inv.notified_whatsapp,
          synced_at: inv.synced_at,
        })
      ),
    })
  );

  let pendentesDesvinculo: Awaited<
    ReturnType<typeof listDesvinculosPendentesManuais>
  > = [];

  try {
    pendentesDesvinculo = await listDesvinculosPendentesManuais(service, 50);
  } catch {
    // painel opcional
  }

  return (
    <DashboardShell title="Cobranças">
      <RealtimeRefresher
        tables={[
          "cobrancas",
          "beneficiarios",
          "infinity_customer_status",
          "infinity_invoices",
        ]}
      />
      <BackgroundSync tipo="cobrancas" />
      <div className="space-y-4">
        <DesvinculosPendentesPanel itens={pendentesDesvinculo} />
        {infinityErr ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Não foi possível carregar o sync Infinity: {infinityErr.message}
          </p>
        ) : null}
        <CobrancasTabs
          cobrancasAsaas={cobrancas ?? []}
          cobrancasInfinity={infinityNormalized}
        />
      </div>
    </DashboardShell>
  );
}
