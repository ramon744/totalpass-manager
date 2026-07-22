/**
 * Status de pagamento da InfinitePay (códigos da API/sync).
 * Exibição sempre em pt-BR; códigos internos permanecem em inglês.
 */
export const INFINITY_PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  manually_paid: "Pago (manual)",
  pending: "Pendente",
  overdue: "Em atraso",
  unknown: "Sem fatura",
  inactive: "Inativo",
  no_invoices: "Sem fatura",
  cancelled: "Cancelada",
  canceled: "Cancelada",
};

export function formatInfinityPaymentStatus(
  status: string | null | undefined
): string {
  if (!status) return "—";
  const key = String(status).toLowerCase().trim();
  return INFINITY_PAYMENT_STATUS_LABELS[key] ?? status;
}

/** Normaliza status de fatura Infinity (baixa manual, settled, etc.). */
export function coerceInfinityInvoiceStatus(
  status: string | null | undefined,
  paidAt?: string | null
): string {
  const s = String(status || "unknown").toLowerCase().trim();
  if (
    ["paid", "manually_paid", "settled", "paid_out", "received", "success"].includes(
      s
    )
  ) {
    return "paid";
  }
  if (s === "canceled") return "cancelled";
  if (["overdue", "pending", "inactive", "cancelled", "unknown"].includes(s)) {
    if (paidAt && s !== "cancelled" && s !== "inactive") return "paid";
    return s;
  }
  if (paidAt) return "paid";
  return "unknown";
}

/** Status do cliente a partir das faturas (não confia no card "Atrasada"). */
export function deriveInfinityCustomerStatusFromInvoices(
  invoices: { status?: string | null; paid_at?: string | null }[]
): "overdue" | "pending" | "paid" | null {
  if (!invoices.length) return null;
  const open = invoices.filter((i) => {
    if (i.paid_at) return false;
    const st = coerceInfinityInvoiceStatus(i.status, i.paid_at);
    return st === "overdue" || st === "pending";
  });
  if (open.some((i) => coerceInfinityInvoiceStatus(i.status) === "overdue")) {
    return "overdue";
  }
  if (open.some((i) => coerceInfinityInvoiceStatus(i.status) === "pending")) {
    return "pending";
  }
  if (
    invoices.some((i) => {
      const st = coerceInfinityInvoiceStatus(i.status, i.paid_at);
      return st === "paid" || Boolean(i.paid_at);
    })
  ) {
    return "paid";
  }
  return null;
}
