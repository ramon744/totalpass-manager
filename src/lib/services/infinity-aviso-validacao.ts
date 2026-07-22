import type { SupabaseClient } from "@supabase/supabase-js";
import { createLog } from "@/lib/logger";
import { getInfinityConfigRaw } from "@/lib/config";
import { notifyAdminAlert } from "@/lib/services/admin-alerts";
import {
  getInfinityHealthStatus,
  resolveInfinityAdminContacts,
} from "@/lib/services/infinity-bridge";
import {
  scheduleMessage,
  drainMessageQueue,
} from "@/lib/services/messages";
import { formatDataLimiteComHora } from "@/lib/message-templates";
import { enqueueBridgeJob, getBridgeConfig } from "@/lib/services/bridge-jobs";
import { getBrazilDateString } from "@/lib/services/reminder-schedule";

function addDaysIso(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatBrDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export type InfinityValidacaoFase = "aviso" | "desvinculo";

/**
 * Enfileira validação leve (extensão consulta só esses IDs na InfinitePay).
 * Não avisa o cliente e não desvincula até confirmar overdue.
 */
export async function enqueueInfinityAvisoValidacao(
  supabase: SupabaseClient,
  params: {
    infinityCustomerId: string;
    beneficiarioId: string;
    fase: InfinityValidacaoFase;
  }
): Promise<{ created: boolean; id?: string }> {
  const { data: existing } = await supabase
    .from("infinity_aviso_validacoes")
    .select("id, status")
    .eq("infinity_customer_id", params.infinityCustomerId)
    .eq("fase", params.fase)
    .in("status", ["pending", "claimed", "error"])
    .maybeSingle();

  if (existing?.id) {
    if (existing.status === "error") {
      await supabase
        .from("infinity_aviso_validacoes")
        .update({
          status: "pending",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return { created: false, id: existing.id };
  }

  const { data, error } = await supabase
    .from("infinity_aviso_validacoes")
    .insert({
      infinity_customer_id: params.infinityCustomerId,
      beneficiario_id: params.beneficiarioId,
      fase: params.fase,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    // corrida no unique parcial
    if (/duplicate|unique/i.test(error.message)) {
      return { created: false };
    }
    throw new Error(error.message);
  }

  return { created: true, id: data.id };
}

/** Reabre claimed antigos (>90s) para pending — validação deve ser rápida. */
export async function reclaimStaleInfinityValidacoes(
  supabase: SupabaseClient,
  staleMinutes = 1.5
) {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  await supabase
    .from("infinity_aviso_validacoes")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "claimed")
    .lt("claimed_at", cutoff);
}

/**
 * Extensão claima lote para sync leve só desses clientes.
 * Inclui invoice_slug/amount/due do snapshot Manager (evita caçar slug na API).
 * Também reprocessa claimed da mesma instalação (SW morto no meio).
 */
export async function claimInfinityValidacoes(
  supabase: SupabaseClient,
  installationId: string,
  limit = 20
) {
  await reclaimStaleInfinityValidacoes(supabase);

  // Reabre claimed desta instalação sem resultado (service worker morreu no meio)
  await supabase
    .from("infinity_aviso_validacoes")
    .update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "claimed")
    .eq("claimed_by", installationId)
    .is("validated_at", null);

  const { data: rows } = await supabase
    .from("infinity_aviso_validacoes")
    .select("id, infinity_customer_id, beneficiario_id, fase, status")
    .in("status", ["pending", "error"])
    .order("created_at", { ascending: true })
    .limit(limit);

  const claimed: Array<{
    id: string;
    infinity_customer_id: string;
    beneficiario_id: string;
    fase: string;
    invoice_slug?: string | null;
    amount?: number | null;
    due_date?: string | null;
    invoice_description?: string | null;
    payment_status?: string | null;
  }> = [];
  const now = new Date().toISOString();
  for (const row of rows ?? []) {
    const { data, error } = await supabase
      .from("infinity_aviso_validacoes")
      .update({
        status: "claimed",
        claimed_at: now,
        claimed_by: installationId,
        updated_at: now,
      })
      .eq("id", row.id)
      .in("status", ["pending", "error"])
      .select("id, infinity_customer_id, beneficiario_id, fase")
      .maybeSingle();
    if (!error && data) claimed.push(data);
  }

  if (claimed.length) {
    const ids = claimed.map((c) => String(c.infinity_customer_id));
    const { data: statuses } = await supabase
      .from("infinity_customer_status")
      .select(
        "infinity_customer_id, invoice_slug, amount, due_date, invoice_description, payment_status"
      )
      .in("infinity_customer_id", ids);

    const byId = new Map(
      (statuses ?? []).map((s) => [String(s.infinity_customer_id), s])
    );
    for (const item of claimed) {
      const st = byId.get(String(item.infinity_customer_id));
      if (!st) continue;
      item.invoice_slug = st.invoice_slug ? String(st.invoice_slug) : null;
      item.amount = st.amount != null ? Number(st.amount) : null;
      item.due_date = st.due_date ? String(st.due_date).slice(0, 10) : null;
      item.invoice_description = st.invoice_description
        ? String(st.invoice_description)
        : null;
      item.payment_status = st.payment_status
        ? String(st.payment_status)
        : null;
    }
  }

  return claimed;
}

/**
 * Extensão reporta resultado da consulta InfinitePay.
 */
export async function reportInfinityValidacao(
  supabase: SupabaseClient,
  params: {
    id: string;
    installationId: string;
    paymentStatus: string;
    error?: string | null;
    details?: {
      paymentLink?: string | null;
      allowPaymentAfterDueDate?: boolean | null;
      invoiceSlug?: string | null;
      amount?: number | null;
      dueDate?: string | null;
      description?: string | null;
    } | null;
  }
) {
  const now = new Date().toISOString();
  const raw = String(params.paymentStatus || "").toLowerCase();
  const normalized = [
    "paid",
    "manually_paid",
    "settled",
    "paid_plans_invoices",
  ].includes(raw)
    ? "paid"
    : ["overdue", "pending", "inactive"].includes(raw)
      ? raw
      : params.error
        ? null
        : "unknown";

  const details = {
    ...(params.details && typeof params.details === "object"
      ? params.details
      : {}),
  };

  if (params.error || !normalized) {
    await supabase
      .from("infinity_aviso_validacoes")
      .update({
        status: "error",
        last_error: String(params.error || "status_desconhecido").slice(0, 400),
        validated_at: now,
        validated_payment_status: normalized,
        details,
        updated_at: now,
      })
      .eq("id", params.id);
    return { ok: true, status: "error" as const };
  }

  if (normalized === "paid" || normalized === "inactive") {
    const { data: valRow } = await supabase
      .from("infinity_aviso_validacoes")
      .select("infinity_customer_id")
      .eq("id", params.id)
      .maybeSingle();

    await supabase
      .from("infinity_aviso_validacoes")
      .update({
        status: "cleared_paid",
        validated_at: now,
        validated_payment_status: normalized,
        last_error: null,
        details,
        updated_at: now,
      })
      .eq("id", params.id);

    if (normalized === "paid" && valRow?.infinity_customer_id) {
      await supabase
        .from("infinity_customer_status")
        .update({
          payment_status: "paid",
          updated_at: now,
        })
        .eq("infinity_customer_id", valRow.infinity_customer_id);
    }
    return { ok: true, status: "cleared_paid" as const };
  }

  if (normalized === "overdue") {
    await supabase
      .from("infinity_aviso_validacoes")
      .update({
        status: "confirmed_overdue",
        validated_at: now,
        validated_payment_status: "overdue",
        last_error: null,
        details,
        updated_at: now,
      })
      .eq("id", params.id);
    return { ok: true, status: "confirmed_overdue" as const };
  }

  // pending / unknown → volta para pending (tenta de novo depois)
  await supabase
    .from("infinity_aviso_validacoes")
    .update({
      status: "pending",
      validated_at: now,
      validated_payment_status: normalized,
      claimed_at: null,
      claimed_by: null,
      last_error: `status_ainda_${normalized}`,
      details,
      updated_at: now,
    })
    .eq("id", params.id);
  return { ok: true, status: "requeued" as const };
}

/**
 * Alerta admin: validação pendente e extensão offline/erro.
 * Prioridade WhatsApp; e-mail se WA indisponível (notifyAdminAlert).
 */
export async function alertAdminInfinityValidacaoBlocked(
  supabase: SupabaseClient,
  params: { pendingCount: number; reason: string }
) {
  const contacts = await resolveInfinityAdminContacts(supabase);
  if (!contacts.admin_email && !contacts.admin_telefone) {
    return { sent: false, reason: "sem_contato_admin" };
  }

  return notifyAdminAlert(supabase, {
    throttleKey: "infinity_validacao_blocked",
    subject: `[Infinity] Validação pendente — extensão ${params.reason}`,
    text: [
      "⚠️ Avisos/desvínculos Infinity estão pausados.",
      "",
      `Motivo: ${params.reason}`,
      `Validações pendentes: ${params.pendingCount}`,
      "",
      "O sistema NÃO avisou o cliente e NÃO desvinculou.",
      "Quando a extensão Infinity Bridge voltar, a consulta será refeita.",
      "",
      `Detectado em: ${new Date().toLocaleString("pt-BR")}`,
    ].join("\n"),
    logAction: "infinity_validacao_blocked_admin",
    logPayload: params,
  });
}

/**
 * Após extensão confirmar overdue: envia aviso WhatsApp ou enfileira desvínculo.
 */
export async function processConfirmedInfinityValidacoes(
  supabase: SupabaseClient
) {
  const infinity = await getInfinityConfigRaw(supabase);
  const dryRun = infinity.dry_run === true;
  const today = getBrazilDateString(new Date());
  const summary = {
    avisosEnviados: 0,
    desvinculosEnfileirados: 0,
    limposPagos: 0,
    skipped: 0,
    errors: [] as string[],
  };

  // Pagos confirmados → só limpa
  const { data: cleared } = await supabase
    .from("infinity_aviso_validacoes")
    .select("id")
    .eq("status", "cleared_paid")
    .limit(100);
  for (const row of cleared ?? []) {
    await supabase
      .from("infinity_aviso_validacoes")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    summary.limposPagos++;
  }

  const { data: confirmed } = await supabase
    .from("infinity_aviso_validacoes")
    .select(
      "id, infinity_customer_id, beneficiario_id, fase, details, beneficiario:beneficiarios!inner(id, nome, cpf, telefone, status_totalpass)"
    )
    .eq("status", "confirmed_overdue")
    .order("validated_at", { ascending: true })
    .limit(40);

  for (const row of confirmed ?? []) {
    const ben = Array.isArray(row.beneficiario)
      ? row.beneficiario[0]
      : row.beneficiario;
    if (!ben?.id) {
      summary.skipped++;
      continue;
    }
    const customerId = String(row.infinity_customer_id);

    try {
      if (row.fase === "aviso") {
        const { data: existingAviso } = await supabase
          .from("infinity_desvinculo_avisos")
          .select("id")
          .eq("beneficiario_id", ben.id)
          .eq("infinity_customer_id", customerId)
          .maybeSingle();

        if (existingAviso) {
          await supabase
            .from("infinity_aviso_validacoes")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          summary.skipped++;
          continue;
        }

        const { data: cust } = await supabase
          .from("infinity_customer_status")
          .select("amount, due_date, invoice_description, invoice_slug")
          .eq("infinity_customer_id", customerId)
          .maybeSingle();

        const details =
          row.details && typeof row.details === "object"
            ? (row.details as Record<string, unknown>)
            : {};
        const paymentLink =
          typeof details.paymentLink === "string" && details.paymentLink.trim()
            ? details.paymentLink.trim()
            : null;
        const allowAfterDue = details.allowPaymentAfterDueDate !== false;
        const linkUsable = Boolean(paymentLink && allowAfterDue);

        const bridgeCfg = await getBridgeConfig(supabase);
        const dataLimite = addDaysIso(
          today,
          bridgeCfg.dias_aviso_final || 3
        );
        const dataLimiteLabel = formatDataLimiteComHora(dataLimite);
        const dueStr =
          (typeof details.dueDate === "string" && details.dueDate) ||
          (cust?.due_date ? String(cust.due_date).slice(0, 10) : today);
        const valor =
          typeof details.amount === "number"
            ? details.amount
            : cust?.amount != null
              ? Number(cust.amount)
              : 0;
        const temPlanoAtivo = ["ativo"].includes(ben.status_totalpass);
        const mensagemPlano = temPlanoAtivo
          ? `Caso tenha plano ativo, você só conseguirá utilizar até o final do ciclo (data limite ${dataLimiteLabel}).`
          : "Caso não tenha plano ativo, não conseguirá contratar pela empresa após o desvinculo.";
        const descricao =
          (typeof details.description === "string" && details.description) ||
          cust?.invoice_description ||
          "Manutenção TotalPass (InfinitePay)";
        const instrucaoPagamento = linkUsable
          ? "Toque no botão abaixo para regularizar o pagamento."
          : "O link desta cobrança não aceita pagamento após o vencimento. Entre em contato conosco pelo WhatsApp para liberar a cobrança ou receber uma nova forma de pagamento.";

        if (dryRun) {
          await createLog(supabase, {
            acao: "infinity_dry_run_aviso_apos_validacao",
            entidade: "infinity_aviso_validacoes",
            entidade_id: row.id,
            payload: {
              customerId,
              linkUsable,
              paymentLink,
              allowAfterDue,
            },
          });
        } else {
          await supabase.from("infinity_desvinculo_avisos").insert({
            beneficiario_id: ben.id,
            infinity_customer_id: customerId,
            infinity_invoice_slug:
              (typeof details.invoiceSlug === "string" &&
                details.invoiceSlug) ||
              cust?.invoice_slug ||
              null,
            data_limite: dataLimite,
          });
          await scheduleMessage(supabase, {
            evento: "aviso_desvinculo_totalpass",
            beneficiarioId: ben.id,
            vars: {
              nome: ben.nome,
              valor: valor.toFixed(2).replace(".", ","),
              data_vencimento: formatBrDate(String(dueStr).slice(0, 10)),
              data_limite: dataLimiteLabel,
              tem_plano_ativo: temPlanoAtivo ? "sim" : "nao",
              mensagem_plano: mensagemPlano,
              link_pagamento: linkUsable ? paymentLink! : "",
              instrucao_pagamento: instrucaoPagamento,
              beneficio_fornecido: "TotalPass",
              descricao,
            },
            refId: `desvinculo-infinity:${customerId}`,
          });
        }

        await supabase
          .from("infinity_aviso_validacoes")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        summary.avisosEnviados++;
        continue;
      }

      // fase desvinculo
      if (dryRun) {
        await createLog(supabase, {
          acao: "infinity_dry_run_desvinculo_apos_validacao",
          entidade: "infinity_aviso_validacoes",
          entidade_id: row.id,
        });
      } else {
        const { data: aviso } = await supabase
          .from("infinity_desvinculo_avisos")
          .select("data_limite")
          .eq("beneficiario_id", ben.id)
          .eq("infinity_customer_id", customerId)
          .maybeSingle();

        await enqueueBridgeJob(supabase, {
          beneficiarioId: ben.id,
          cpf: ben.cpf,
          infinityCustomerId: customerId,
          dataLimite: aviso?.data_limite || today,
          motivo: "inadimplencia_infinity",
        });
      }

      await supabase
        .from("infinity_aviso_validacoes")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      summary.desvinculosEnfileirados++;
    } catch (e) {
      summary.errors.push(
        `${customerId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (!dryRun && summary.avisosEnviados > 0) {
    try {
      await drainMessageQueue(supabase);
    } catch {
      // cron de mensagens processa depois
    }
  }

  return summary;
}

/**
 * Snapshots no banco: pagos já com amount+paid_at (skip enrich).
 */
export async function listInfinityEnrichSnapshots(
  supabase: SupabaseClient,
  customerIds?: string[]
) {
  let q = supabase
    .from("infinity_customer_status")
    .select(
      "infinity_customer_id, payment_status, amount, due_date, paid_at, infinity_subscription_slug"
    );

  if (customerIds?.length) {
    q = q.in("infinity_customer_id", customerIds.slice(0, 500));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const completeIds: string[] = [];
  const incompletePaidIds: string[] = [];
  const snapshots: Array<{
    infinityCustomerId: string;
    paymentStatus: string;
    amount: number | null;
    dueDate: string | null;
    paidAt: string | null;
    infinitySubscriptionSlug: string | null;
  }> = [];

  for (const row of data ?? []) {
    const id = String(row.infinity_customer_id);
    const status = String(row.payment_status || "unknown");
    const amount = row.amount != null ? Number(row.amount) : null;
    const paidAt = row.paid_at ? String(row.paid_at) : null;
    const snap = {
      infinityCustomerId: id,
      paymentStatus: status,
      amount,
      dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
      paidAt,
      infinitySubscriptionSlug: row.infinity_subscription_slug
        ? String(row.infinity_subscription_slug)
        : null,
    };
    snapshots.push(snap);
    if (status === "paid" && amount != null && paidAt) {
      completeIds.push(id);
    } else if (status === "paid") {
      incompletePaidIds.push(id);
    }
  }

  return { completeIds, incompletePaidIds, snapshots };
}

/**
 * Se há validações abertas e extensão offline → alerta admin (não notifica cliente).
 */
export async function maybeAlertPendingValidacoesWhenOffline(
  supabase: SupabaseClient
) {
  const infinity = await getInfinityConfigRaw(supabase);
  if (!infinity.ativa || !infinity.automacao_desvinculo_ativa) {
    return { sent: false, reason: "automacao_ou_infinity_off" };
  }

  const health = await getInfinityHealthStatus(supabase, infinity);
  const { count } = await supabase
    .from("infinity_aviso_validacoes")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "claimed", "error"]);

  const pendingCount = count ?? 0;
  if (pendingCount === 0) {
    return { sent: false, reason: "sem_pendencias" };
  }

  if (health.online) {
    return { sent: false, reason: "online", pendingCount };
  }

  return alertAdminInfinityValidacaoBlocked(supabase, {
    pendingCount,
    reason: health.reason || "offline",
  });
}
