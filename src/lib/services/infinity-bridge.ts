import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBridgeConfigRaw,
  getInfinityConfigRaw,
  getUazapiConfig,
} from "@/lib/config";
import { createLog } from "@/lib/logger";
import { notifyAdminAlert } from "@/lib/services/admin-alerts";
import { sendAdminEmail } from "@/lib/email/resend";
import { UazapiClient, renderTemplate } from "@/lib/uazapi/client";
import { normalizePhone } from "@/lib/utils";
import {
  coerceInfinityInvoiceStatus,
  deriveInfinityCustomerStatusFromInvoices,
} from "@/lib/infinity-payment-status";
import type { ConfigInfinity } from "@/types/database";
import { DEFAULT_INFINITY_CONFIG } from "@/types/database";

export async function getInfinityConfig(
  supabase: SupabaseClient
): Promise<Required<ConfigInfinity>> {
  return getInfinityConfigRaw(supabase);
}

export type InfinityHealthStatus = {
  online: boolean;
  reason: string;
  lastSeenAt: string | null;
  sessionOk: boolean | null;
  installationId: string | null;
  lastError: string | null;
  extensionVersion: string | null;
  lastOfflineAlertAt: string | null;
  overdueCount: number;
};

/**
 * Saúde da extensão Infinity:
 * online se QUALQUER instância tiver heartbeat recente + sessão ok.
 */
export async function getInfinityHealthStatus(
  supabase: SupabaseClient,
  cfg?: Required<ConfigInfinity>
): Promise<InfinityHealthStatus> {
  const infinity = cfg ?? (await getInfinityConfig(supabase));
  const ttlMs = infinity.heartbeat_ttl_minutos * 60_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  const { data: instances } = await supabase
    .from("infinity_instances")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(20);

  if (!instances?.length) {
    return {
      online: false,
      reason: "nenhuma_extensao",
      lastSeenAt: null,
      sessionOk: null,
      installationId: null,
      lastError: null,
      extensionVersion: null,
      lastOfflineAlertAt: null,
      overdueCount: 0,
    };
  }

  const isHealthy = (inst: (typeof instances)[number]) =>
    Boolean(inst.session_ok) &&
    inst.last_seen_at >= cutoff &&
    inst.last_health_ok !== false;

  const healthy = instances.find(isHealthy);
  const latest = instances[0];
  const lastOfflineAlertAt =
    instances
      .map((i) => i.last_offline_alert_at as string | null)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  if (healthy) {
    return {
      online: true,
      reason: "ok",
      lastSeenAt: healthy.last_seen_at,
      sessionOk: true,
      installationId: healthy.installation_id,
      lastError: healthy.last_error ?? null,
      extensionVersion: healthy.extension_version ?? null,
      lastOfflineAlertAt,
      overdueCount: Number(healthy.overdue_count ?? 0),
    };
  }

  let reason = "sessao_infinity_invalida";
  if (!latest.session_ok) reason = "sessao_infinity_invalida";
  else if (latest.last_seen_at < cutoff) reason = "heartbeat_expirado";
  else if (latest.last_health_ok === false) reason = "saude_extensao_ruim";

  return {
    online: false,
    reason,
    lastSeenAt: latest.last_seen_at,
    sessionOk: Boolean(latest.session_ok),
    installationId: latest.installation_id,
    lastError: latest.last_error ?? null,
    extensionVersion: latest.extension_version ?? null,
    lastOfflineAlertAt,
    overdueCount: Number(latest.overdue_count ?? 0),
  };
}

export async function upsertInfinityHeartbeat(
  supabase: SupabaseClient,
  params: {
    installationId: string;
    extensionVersion?: string | null;
    sessionOk: boolean;
    sessionEmail?: string | null;
    lastError?: string | null;
    healthOk?: boolean | null;
    overdueCount?: number | null;
    /** Extensão ainda tentando recuperar sessão — não alerta admin. */
    recovering?: boolean | null;
  }
) {
  const { count: overdueCount } = await supabase
    .from("infinity_customer_status")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "overdue");

  const now = new Date().toISOString();
  const lastError = params.lastError
    ? String(params.lastError).slice(0, 500)
    : null;
  const healthOk =
    params.healthOk == null
      ? params.sessionOk && !lastError
      : Boolean(params.healthOk);

  const { data, error } = await supabase
    .from("infinity_instances")
    .upsert(
      {
        installation_id: params.installationId,
        extension_version: params.extensionVersion ?? null,
        last_seen_at: now,
        session_ok: params.sessionOk,
        session_email: params.sessionEmail ?? null,
        overdue_count:
          params.overdueCount != null
            ? Math.max(0, Number(params.overdueCount))
            : (overdueCount ?? 0),
        last_error: lastError,
        last_health_ok: healthOk,
      },
      { onConflict: "installation_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (lastError && (!healthOk || !params.sessionOk) && !params.recovering) {
    alertAdminInfinitySessionIssue(supabase, {
      installationId: params.installationId,
      error: lastError,
      sessionOk: params.sessionOk,
    }).catch(() => {});
  }

  return {
    instance: data,
    overdueCount: overdueCount ?? 0,
    serverTime: now,
  };
}

export type InfinityInvoiceSyncItem = {
  infinityInvoiceSlug: string;
  infinityCustomerId: string;
  infinitySubscriptionSlug?: string | null;
  status: "overdue" | "pending" | "paid" | "unknown" | "inactive" | "cancelled";
  amount?: number | null;
  dueDate?: string | null;
  paidAt?: string | null;
  description?: string | null;
  notifiedEmail?: boolean | null;
  notifiedWhatsapp?: boolean | null;
  notifications?: unknown;
  raw?: Record<string, unknown>;
};

export type InfinityCustomerSyncItem = {
  infinityCustomerId: string;
  infinitySubscriptionSlug?: string | null;
  nome?: string | null;
  documentNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentStatus: "overdue" | "pending" | "paid" | "unknown" | "inactive";
  amount?: number | null;
  dueDate?: string | null;
  paidAt?: string | null;
  invoiceSlug?: string | null;
  invoiceDescription?: string | null;
  notifiedEmail?: boolean | null;
  notifiedWhatsapp?: boolean | null;
  lastNotifiedAt?: string | null;
  invoiceDetails?: Record<string, unknown> | null;
  invoices?: InfinityInvoiceSyncItem[];
  raw?: Record<string, unknown>;
};

/**
 * Upsert do sync da extensão.
 * - Liga titular por infinity_customer_id ou CPF.
 * - Gateway automático: existe na Infinity → infinity; sumiu do sync → asaas.
 * - Não cria beneficiário, não cria/cancela cobrança Asaas/Infinity.
 * Após sync completo (lista não truncada), remove clientes que sumiram da Infinity
 * e rebaixa órfãos para gateway asaas.
 */

/** Rejeita faturas fantasmas (syn-*) e slug de assinatura gravado como fatura. */
function isRealInfinityInvoiceSlug(
  invSlug: string,
  subscriptionSlug: string | null
): boolean {
  if (!invSlug) return false;
  if (invSlug.startsWith("syn-")) return false;
  if (subscriptionSlug && invSlug === subscriptionSlug) return false;
  // Handles reais da InfinitePay (ex.: Er6yaUhcY7)
  return /^[A-Za-z0-9_-]{6,40}$/.test(invSlug);
}

export async function syncInfinityCustomers(
  supabase: SupabaseClient,
  items: InfinityCustomerSyncItem[],
  userId?: string | null,
  meta?: { listComplete?: boolean; fetchedCount?: number }
) {
  const now = new Date().toISOString();
  const MAX_SYNC = 500;
  const truncated = items.length > MAX_SYNC;
  const listComplete = meta?.listComplete === true;
  let upserted = 0;
  let linked = 0;
  let removed = 0;
  let gatewayToInfinity = 0;
  let gatewayToAsaas = 0;
  let pruneSkipped = false;
  const errors: string[] = [];
  const syncedIds: string[] = [];

  for (const item of items.slice(0, MAX_SYNC)) {
    const customerId = String(item.infinityCustomerId || "").trim();
    if (!customerId) continue;

    const document = item.documentNumber
      ? String(item.documentNumber).replace(/\D/g, "")
      : null;
    const slug = item.infinitySubscriptionSlug?.trim() || null;

    let beneficiarioId: string | null = null;

    const { data: byInfinity } = await supabase
      .from("beneficiarios")
      .select("id, gateway_pagamento")
      .eq("infinity_customer_id", customerId)
      .eq("perfil", "titular")
      .maybeSingle();

    if (byInfinity?.id) {
      beneficiarioId = byInfinity.id;
      if (byInfinity.gateway_pagamento !== "infinity" || slug) {
        const { error: upErr } = await supabase
          .from("beneficiarios")
          .update({
            gateway_pagamento: "infinity",
            infinity_subscription_slug: slug,
            updated_at: now,
          })
          .eq("id", byInfinity.id);
        if (upErr) {
          errors.push(`${customerId}: gateway ${upErr.message}`);
        } else if (byInfinity.gateway_pagamento !== "infinity") {
          gatewayToInfinity++;
        }
      }
    } else if (document && document.length === 11) {
      const { data: byCpf } = await supabase
        .from("beneficiarios")
        .select("id, gateway_pagamento, infinity_customer_id")
        .eq("cpf", document)
        .eq("perfil", "titular")
        .maybeSingle();

      if (byCpf?.id) {
        beneficiarioId = byCpf.id;
        const wasInfinity = byCpf.gateway_pagamento === "infinity";
        const { error: upErr } = await supabase
          .from("beneficiarios")
          .update({
            gateway_pagamento: "infinity",
            infinity_customer_id: customerId,
            infinity_subscription_slug: slug,
            updated_at: now,
          })
          .eq("id", byCpf.id);
        if (upErr) {
          errors.push(`${customerId}: link-cpf ${upErr.message}`);
        } else if (!wasInfinity) {
          gatewayToInfinity++;
        }
      }
    }

    if (beneficiarioId) linked++;

    const invoiceSlugRaw = item.invoiceSlug?.trim() || null;
    const invoiceSlugSafe = isRealInfinityInvoiceSlug(
      invoiceSlugRaw || "",
      slug
    )
      ? invoiceSlugRaw
      : null;

    const invoicesNormalized = (item.invoices ?? []).map((inv) => ({
      ...inv,
      status: coerceInfinityInvoiceStatus(inv.status, inv.paidAt),
    }));
    const derivedFromInvoices = deriveInfinityCustomerStatusFromInvoices(
      invoicesNormalized.map((inv) => ({
        status: inv.status,
        paid_at: inv.paidAt ? String(inv.paidAt) : null,
      }))
    );
    // Preferir faturas reais; lista do cliente só como fallback (não usar paidAt do snapshot para “forçar pago”).
    const paymentStatusRaw = String(item.paymentStatus || "unknown").toLowerCase();
    const paymentStatusFallback = [
      "paid",
      "manually_paid",
      "paid_plans_invoices",
      "settled",
    ].includes(paymentStatusRaw)
      ? "paid"
      : ["overdue", "pending", "inactive"].includes(paymentStatusRaw)
        ? paymentStatusRaw
        : "unknown";
    const paymentStatus = derivedFromInvoices || paymentStatusFallback;

    const paidAtFromInvoices = invoicesNormalized
      .map((inv) => (inv.paidAt ? String(inv.paidAt) : null))
      .filter(Boolean)
      .sort()
      .at(-1);
    const amountFromInvoices = invoicesNormalized.find(
      (inv) => inv.amount != null
    )?.amount;
    const dueFromInvoices = invoicesNormalized.find((inv) => inv.dueDate)
      ?.dueDate;

    // Não apagar valor/Pago em já gravados quando o enrich parcial vem sem faturas
    // (rate limit / cota). Também backfill a partir de infinity_invoices existentes.
    const { data: existingStatus } = await supabase
      .from("infinity_customer_status")
      .select("amount, due_date, paid_at, invoice_details, invoice_slug")
      .eq("infinity_customer_id", customerId)
      .maybeSingle();

    let paidAtFromDb: string | null = null;
    let amountFromDb: number | null = null;
    let dueFromDb: string | null = null;
    if (
      paymentStatus === "paid" &&
      !item.paidAt &&
      !paidAtFromInvoices &&
      (!existingStatus?.paid_at ||
        existingStatus?.amount == null ||
        !existingStatus?.due_date)
    ) {
      const { data: dbInv } = await supabase
        .from("infinity_invoices")
        .select("amount, due_date, paid_at")
        .eq("infinity_customer_id", customerId)
        .eq("status", "paid")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dbInv?.paid_at) paidAtFromDb = String(dbInv.paid_at);
      if (dbInv?.amount != null) amountFromDb = Number(dbInv.amount);
      if (dbInv?.due_date) dueFromDb = String(dbInv.due_date).slice(0, 10);
    }

    const nextAmount =
      item.amount != null
        ? Number(item.amount)
        : amountFromInvoices != null
          ? Number(amountFromInvoices)
          : existingStatus?.amount != null
            ? Number(existingStatus.amount)
            : amountFromDb;
    const nextDue = item.dueDate
      ? String(item.dueDate).slice(0, 10)
      : dueFromInvoices
        ? String(dueFromInvoices).slice(0, 10)
        : existingStatus?.due_date
          ? String(existingStatus.due_date).slice(0, 10)
          : dueFromDb;
    const nextPaidAt =
      paymentStatus === "paid"
        ? item.paidAt
          ? String(item.paidAt)
          : paidAtFromInvoices ||
            (existingStatus?.paid_at
              ? String(existingStatus.paid_at)
              : null) ||
            paidAtFromDb
        : null;

    const incomingDetails = item.invoiceDetails ?? {};
    const keepExistingDetails =
      Object.keys(incomingDetails).length === 0 &&
      existingStatus?.invoice_details &&
      typeof existingStatus.invoice_details === "object";

    const { error } = await supabase.from("infinity_customer_status").upsert(
      {
        infinity_customer_id: customerId,
        infinity_subscription_slug: slug,
        nome: item.nome?.trim() || null,
        document_number: document,
        email: item.email?.trim() || null,
        phone: item.phone?.trim() || null,
        payment_status: paymentStatus,
        amount: nextAmount ?? null,
        due_date: nextDue ?? null,
        paid_at: nextPaidAt,
        invoice_slug: invoiceSlugSafe || existingStatus?.invoice_slug || null,
        invoice_description: item.invoiceDescription?.trim() || null,
        notified_email:
          item.notifiedEmail == null ? null : Boolean(item.notifiedEmail),
        notified_whatsapp:
          item.notifiedWhatsapp == null
            ? null
            : Boolean(item.notifiedWhatsapp),
        last_notified_at: item.lastNotifiedAt
          ? String(item.lastNotifiedAt)
          : null,
        invoice_details: keepExistingDetails
          ? existingStatus!.invoice_details
          : incomingDetails,
        beneficiario_id: beneficiarioId,
        raw: item.raw ?? {},
        synced_at: now,
        updated_at: now,
      },
      { onConflict: "infinity_customer_id" }
    );

    if (error) {
      errors.push(`${customerId}: ${error.message}`);
      continue;
    }
    upserted++;
    syncedIds.push(customerId);

    // Faturas detalhadas (opcional) — só leitura; não cria Asaas / não notifica
    const keptInvoiceSlugs: string[] = [];
    for (const inv of invoicesNormalized) {
      const invSlug = String(inv.infinityInvoiceSlug || "").trim();
      if (!isRealInfinityInvoiceSlug(invSlug, slug)) continue;
      keptInvoiceSlugs.push(invSlug);
      const invStatus = coerceInfinityInvoiceStatus(inv.status, inv.paidAt);
      const { error: invErr } = await supabase.from("infinity_invoices").upsert(
        {
          infinity_invoice_slug: invSlug,
          infinity_customer_id: customerId,
          infinity_subscription_slug:
            inv.infinitySubscriptionSlug?.trim() || slug,
          beneficiario_id: beneficiarioId,
          status: invStatus,
          amount: inv.amount != null ? Number(inv.amount) : null,
          due_date: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null,
          paid_at: inv.paidAt ? String(inv.paidAt) : null,
          description: inv.description?.trim() || null,
          notified_email:
            inv.notifiedEmail == null ? null : Boolean(inv.notifiedEmail),
          notified_whatsapp:
            inv.notifiedWhatsapp == null
              ? null
              : Boolean(inv.notifiedWhatsapp),
          notifications: inv.notifications ?? [],
          raw: inv.raw ?? {},
          synced_at: now,
          updated_at: now,
        },
        { onConflict: "infinity_invoice_slug" }
      );
      if (invErr) {
        errors.push(`${customerId}/inv ${invSlug}: ${invErr.message}`);
      }
    }

    // Remove só fantasmas (syn-* / slug de assinatura).
    // Não apaga faturas reais ausentes do batch (enrich parcial).
    const keptSet = new Set(keptInvoiceSlugs);
    const { data: existingInvs } = await supabase
      .from("infinity_invoices")
      .select("infinity_invoice_slug")
      .eq("infinity_customer_id", customerId);
    const invoiceListComplete =
      item.invoiceDetails?.invoiceListComplete === true;
    const toDelete = (existingInvs ?? [])
      .map((r) => String(r.infinity_invoice_slug || ""))
      .filter((s) => {
        if (!s) return false;
        if (keptSet.has(s)) return false;
        if (s.startsWith("syn-")) return true;
        if (slug != null && s === slug) return true;
        // Só replace completo quando a extensão marcou lista completa
        if (invoiceListComplete && keptSet.size > 0) return true;
        return false;
      });
    if (toDelete.length > 0) {
      const { error: pruneInvErr } = await supabase
        .from("infinity_invoices")
        .delete()
        .in("infinity_invoice_slug", toDelete);
      if (pruneInvErr) {
        errors.push(`${customerId}/prune-inv: ${pruneInvErr.message}`);
      }
    }
  }

  // Sync completo: remove quem não veio nesta leva (excluídos na InfinitePay).
  // Safeguard: exige listComplete + lista >= 80% do que já existia (anti demote em sync parcial).
  const { count: existingBefore } = await supabase
    .from("infinity_customer_status")
    .select("id", { count: "exact", head: true });
  const existingCount = existingBefore ?? 0;
  const minForPrune =
    existingCount === 0 ? 1 : Math.max(10, Math.floor(existingCount * 0.8));
  const allowPrune =
    !truncated &&
    listComplete &&
    syncedIds.length > 0 &&
    syncedIds.length >= minForPrune;

  if (!truncated && syncedIds.length > 0 && !allowPrune) {
    pruneSkipped = true;
    errors.push(
      `prune-skipped: listComplete=${listComplete} synced=${syncedIds.length} min=${minForPrune} existing=${existingCount}`
    );
  }

  if (allowPrune) {
    const { error: delErr, count } = await supabase
      .from("infinity_customer_status")
      .delete({ count: "exact" })
      .lt("synced_at", now);
    if (delErr) {
      errors.push(`prune-delete: ${delErr.message}`);
    } else {
      removed = count ?? 0;
    }

    // Titulares órfãos (tinham Infinity e sumiram do sync) → Asaas.
    // Quem ainda está em infinity_customer_status permanece Infinity.
    const { data: stillLinked } = await supabase
      .from("infinity_customer_status")
      .select("beneficiario_id")
      .not("beneficiario_id", "is", null);

    const keepIds = new Set(
      (stillLinked ?? [])
        .map((r) => r.beneficiario_id as string | null)
        .filter((id): id is string => Boolean(id))
    );

    const { data: infinityTitulares, error: listErr } = await supabase
      .from("beneficiarios")
      .select("id, infinity_customer_id")
      .eq("perfil", "titular")
      .or("gateway_pagamento.eq.infinity,infinity_customer_id.not.is.null");

    if (listErr) {
      errors.push(`demote-list: ${listErr.message}`);
    } else {
      const orphans = (infinityTitulares ?? []).filter(
        (t) => !keepIds.has(t.id)
      );
      for (const orphan of orphans) {
        const { error: demoteErr } = await supabase
          .from("beneficiarios")
          .update({
            gateway_pagamento: "asaas",
            infinity_customer_id: null,
            infinity_subscription_slug: null,
            updated_at: now,
          })
          .eq("id", orphan.id)
          .eq("perfil", "titular");
        if (demoteErr) {
          errors.push(`demote ${orphan.id}: ${demoteErr.message}`);
        } else {
          gatewayToAsaas++;
        }
      }
    }
  }

  await createLog(supabase, {
    usuario_id: userId ?? undefined,
    acao: "infinity_sync_customers",
    entidade: "infinity_customer_status",
    payload: {
      received: items.length,
      upserted,
      linked,
      removed,
      gateway_to_infinity: gatewayToInfinity,
      gateway_to_asaas: gatewayToAsaas,
      truncated,
      list_complete: listComplete,
      prune_skipped: pruneSkipped,
      errors: errors.slice(0, 10),
    },
  });

  const { count: overdueCount } = await supabase
    .from("infinity_customer_status")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "overdue");

  return {
    upserted,
    linked,
    removed,
    gatewayToInfinity,
    gatewayToAsaas,
    overdueCount: overdueCount ?? 0,
    pruneSkipped,
    listComplete,
    errors: errors.slice(0, 20),
  };
}

export async function getInfinityStatusSummary(supabase: SupabaseClient) {
  const [
    { data: instances },
    { count: overdue },
    { count: pending },
    { count: paid },
    health,
  ] = await Promise.all([
    supabase
      .from("infinity_instances")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(5),
    supabase
      .from("infinity_customer_status")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "overdue"),
    supabase
      .from("infinity_customer_status")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "pending"),
    supabase
      .from("infinity_customer_status")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "paid"),
    getInfinityHealthStatus(supabase),
  ]);

  return {
    instances: instances ?? [],
    overdue: overdue ?? 0,
    pending: pending ?? 0,
    paid: paid ?? 0,
    health,
  };
}

export async function resolveInfinityAdminContacts(supabase: SupabaseClient) {
  const infinity = await getInfinityConfig(supabase);
  const bridge = await getBridgeConfigRaw(supabase);
  return {
    admin_email: infinity.admin_email || bridge.admin_email || "",
    admin_telefone: infinity.admin_telefone || bridge.admin_telefone || "",
    alerta_offline_intervalo_horas:
      infinity.alerta_offline_intervalo_horas ||
      DEFAULT_INFINITY_CONFIG.alerta_offline_intervalo_horas,
  };
}

export async function alertAdminInfinitySessionIssue(
  supabase: SupabaseClient,
  params: {
    installationId: string;
    error: string;
    sessionOk: boolean;
  }
) {
  const contacts = await resolveInfinityAdminContacts(supabase);
  if (!contacts.admin_email && !contacts.admin_telefone) return;

  await notifyAdminAlert(supabase, {
    throttleKey: `infinity_session:${params.installationId}`,
    subject: "InfinitePay — sessão/extensão com problema",
    text: [
      "A extensão InfinitePay reportou problema.",
      "",
      `Instalação: ${params.installationId}`,
      `Sessão ok: ${params.sessionOk ? "sim" : "não"}`,
      `Erro: ${params.error}`,
      "",
      "Abra app.infinitepay.io logado e confira a extensão Infinity Bridge.",
    ].join("\n"),
    logAction: "infinity_admin_alert_session",
    logPayload: {
      installationId: params.installationId,
      sessionOk: params.sessionOk,
    },
  });
}

/**
 * Alerta admin se extensão Infinity offline (cron).
 * Não exige jobs pendentes — avisa se ativa e offline.
 */
export async function sendInfinityOfflineAdminAlert(
  supabase: SupabaseClient
): Promise<{
  sent: boolean;
  reason?: string;
  channels?: { whatsapp?: boolean; email?: boolean };
}> {
  const infinity = await getInfinityConfig(supabase);
  if (!infinity.ativa) {
    return { sent: false, reason: "infinity_desligada" };
  }

  const contacts = await resolveInfinityAdminContacts(supabase);
  if (!contacts.admin_email && !contacts.admin_telefone) {
    return {
      sent: false,
      reason: "configure admin_email e/ou admin_telefone (Infinity ou Bridge)",
    };
  }

  const health = await getInfinityHealthStatus(supabase, infinity);
  if (health.online) {
    return { sent: false, reason: "infinity online com sessão" };
  }

  const alertIntervalMs = contacts.alerta_offline_intervalo_horas * 60 * 60_000;
  if (
    health.lastOfflineAlertAt &&
    Date.now() - new Date(health.lastOfflineAlertAt).getTime() < alertIntervalMs
  ) {
    return { sent: false, reason: "alerta em throttle" };
  }

  const { data: template } = await supabase
    .from("mensagem_templates")
    .select("*")
    .eq("evento", "infinity_offline_admin")
    .eq("ativo", true)
    .maybeSingle();

  const ultimoHeartbeat = health.lastSeenAt
    ? new Date(health.lastSeenAt).toLocaleString("pt-BR")
    : "nunca";

  const corpo =
    template?.corpo ??
    "Extensão InfinitePay offline. Overdue: {{overdue_count}}. Último: {{ultimo_heartbeat}}. Motivo: {{motivo}}";

  const mensagem = renderTemplate(corpo, {
    overdue_count: String(health.overdueCount),
    ultimo_heartbeat: ultimoHeartbeat,
    motivo: health.reason,
  });

  const channels: { email?: boolean; whatsapp?: boolean } = {};
  const errors: string[] = [];

  if (contacts.admin_email) {
    const emailResult = await sendAdminEmail({
      to: contacts.admin_email,
      subject: "⚠️ Extensão InfinitePay offline",
      text: [
        mensagem,
        "",
        "Detalhes:",
        `- Motivo: ${health.reason}`,
        `- Sessão: ${health.sessionOk ? "ok" : "offline"}`,
        `- Versão: ${health.extensionVersion || "?"}`,
        health.lastError ? `- Erro: ${health.lastError}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (emailResult.ok) channels.email = true;
    else errors.push(`email: ${emailResult.reason}`);
  }

  if (contacts.admin_telefone) {
    try {
      const uazapi = await getUazapiConfig(supabase);
      if (uazapi.url && uazapi.token) {
        const client = new UazapiClient(uazapi);
        const readiness = await client.isReadyToSend();
        if (readiness.ready) {
          await client.sendText(
            normalizePhone(contacts.admin_telefone),
            mensagem
          );
          channels.whatsapp = true;
        } else {
          errors.push(`whatsapp: uazapi ${readiness.status}`);
        }
      } else {
        errors.push("whatsapp: uazapi não configurada");
      }
    } catch (e) {
      errors.push(
        `whatsapp: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const sent = Boolean(channels.email || channels.whatsapp);
  if (sent && health.installationId) {
    await supabase
      .from("infinity_instances")
      .update({ last_offline_alert_at: new Date().toISOString() })
      .eq("installation_id", health.installationId);
  }

  await createLog(supabase, {
    acao: "infinity_offline_admin_alert",
    entidade: "infinity_instances",
    payload: {
      sent,
      channels,
      reason: health.reason,
      errors: errors.slice(0, 5),
    },
  });

  return {
    sent,
    reason: sent ? undefined : errors.join("; ") || "falha ao enviar",
    channels: sent ? channels : undefined,
  };
}
