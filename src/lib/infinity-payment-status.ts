/**
 * Status de pagamento da InfinitePay (códigos da API/sync).
 * Exibição sempre em pt-BR; códigos internos permanecem em inglês.
 */
export const INFINITY_PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  overdue: "Em atraso",
  unknown: "Sem fatura",
  inactive: "Inativo",
  no_invoices: "Sem fatura",
};

export function formatInfinityPaymentStatus(
  status: string | null | undefined
): string {
  if (!status) return "—";
  const key = String(status).toLowerCase().trim();
  return INFINITY_PAYMENT_STATUS_LABELS[key] ?? status;
}
