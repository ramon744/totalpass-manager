/** Variáveis de exemplo para prévia e testes de envio. */
export const TEMPLATE_SAMPLE_VARS: Record<string, string> = {
  nome: "Cliente Teste",
  beneficio_fornecido: "TotalPass",
  valor: "16,99",
  vencimento: "10",
  data_vencimento: "10/07/2026",
  link_fatura: "https://www.asaas.com/i/exemplo-fatura",
  codigo_pix: "00020126580014BR.GOV.BCB.PIX0136123e4567-e89b-12d3-a456-426614174000",
  linha_digitavel: "23793.38128 60000.000003 00000.000400 1 84340000001699",
  dependentes: "Maria Silva",
  valor_dependente: "10,00",
  valor_dependentes: "10,00",
  valor_total: "26,99",
  vigencia: "na próxima fatura",
  motivo: "atualização de dependentes",
};

const COBRANCA_EVENTS = new Set([
  "cobranca_gerada",
  "pagamento_confirmado",
  "vencimento_3dias",
  "vencimento_dia",
  "vencimento_1dia",
  "vencimento_7dias",
]);

const ASSINATURA_EVENTS = new Set([
  "assinatura_criada",
  "assinatura_cancelada",
  "dependente_cobranca_iniciada",
  "dependente_cobranca_parada",
  "dependente_cobranca_retomada",
]);

/** Variáveis disponíveis por tipo de evento do template. */
export function getVariablesForEvent(evento: string): string[] {
  const base = ["nome", "beneficio_fornecido"];

  if (COBRANCA_EVENTS.has(evento)) {
    return [
      ...base,
      "valor",
      "data_vencimento",
      "link_fatura",
      "codigo_pix",
      "linha_digitavel",
    ];
  }

  // A assinatura criada gera a primeira cobrança (PIX/boleto), então também
  // disponibiliza as variáveis de pagamento.
  if (evento === "assinatura_criada") {
    return [
      ...base,
      "valor",
      "vencimento",
      "data_vencimento",
      "link_fatura",
      "codigo_pix",
      "linha_digitavel",
    ];
  }

  if (ASSINATURA_EVENTS.has(evento)) {
    if (evento.startsWith("dependente_cobranca_")) {
      return [
        ...base,
        "dependentes",
        "valor_dependente",
        "valor_dependentes",
        "valor_total",
        "vigencia",
        "motivo",
      ];
    }
    return [...base, "valor", "vencimento"];
  }

  return base;
}

export function renderTemplatePreview(corpo: string): string {
  return corpo.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    TEMPLATE_SAMPLE_VARS[key] ?? `{{${key}}}`
  );
}
