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
  data_limite: "20/07/2026 às 23:59",
  tem_plano_ativo: "sim",
  mensagem_plano:
    "Caso tenha plano ativo, você só conseguirá utilizar até o final do ciclo (data limite 20/07/2026 às 23:59).",
  link_pagamento: "https://www.asaas.com/i/exemplo-fatura",
  pending_count: "3",
  ultimo_heartbeat: "15/07/2026 14:00",
};

const COBRANCA_EVENTS = new Set([
  "cobranca_gerada",
  "pagamento_confirmado",
  "vencimento_3dias",
  "vencimento_dia",
  "vencimento_1dia",
]);

const DESVINCULO_EVENTS = new Set(["aviso_desvinculo_totalpass"]);

const ASSINATURA_EVENTS = new Set([
  "assinatura_criada",
  "assinatura_cancelada",
  "dependente_cobranca_iniciada",
  "dependente_cobranca_parada",
  "dependente_cobranca_retomada",
]);

export type TemplateGroupId =
  | "lembretes"
  | "inadimplencia"
  | "cobranca"
  | "assinatura"
  | "admin"
  | "outros";

export interface TemplateGroupMeta {
  id: TemplateGroupId;
  titulo: string;
  descricao: string;
  order: number;
}

export interface TemplateEventMeta {
  grupo: TemplateGroupId;
  /** Ordem dentro do grupo */
  order: number;
  tituloAmigavel: string;
  /** Texto base; pode ser enriquecido com prazos da Bridge. */
  quando: string;
}

export const TEMPLATE_GROUPS: TemplateGroupMeta[] = [
  {
    id: "lembretes",
    titulo: "1. Lembretes de fatura",
    descricao: "Avisos antes e logo após o vencimento, para lembrar do pagamento.",
    order: 1,
  },
  {
    id: "inadimplencia",
    titulo: "2. Inadimplência e desvínculo",
    descricao:
      "Depois da carência de atraso: aviso com prazo final e, se não pagar, cancelamento.",
    order: 2,
  },
  {
    id: "cobranca",
    titulo: "3. Cobrança e pagamento",
    descricao: "Quando a fatura é gerada ou o pagamento é confirmado.",
    order: 3,
  },
  {
    id: "assinatura",
    titulo: "4. Assinatura e dependentes",
    descricao: "Criação de assinatura e mudanças de valor com dependentes.",
    order: 4,
  },
  {
    id: "admin",
    titulo: "5. Admin / sistema",
    descricao: "Alertas internos (não vão para o cliente).",
    order: 5,
  },
  {
    id: "outros",
    titulo: "Outros",
    descricao: "Templates sem classificação.",
    order: 99,
  },
];

const TEMPLATE_EVENTS: Record<string, TemplateEventMeta> = {
  vencimento_3dias: {
    grupo: "lembretes",
    order: 1,
    tituloAmigavel: "3 dias antes do vencimento",
    quando: "Enviado 3 dias antes da data de vencimento da fatura.",
  },
  vencimento_dia: {
    grupo: "lembretes",
    order: 2,
    tituloAmigavel: "No dia do vencimento",
    quando: "Enviado no dia em que a fatura vence.",
  },
  vencimento_1dia: {
    grupo: "lembretes",
    order: 3,
    tituloAmigavel: "1 dia depois do vencimento",
    quando: "Enviado 1 dia após o vencimento, se ainda estiver em aberto.",
  },
  aviso_desvinculo_totalpass: {
    grupo: "inadimplencia",
    order: 1,
    tituloAmigavel: "Aviso de desvínculo (com data limite)",
    quando:
      "Enviado após a carência de atraso. Informa a data e hora limite para pagar antes do desvínculo no TotalPass.",
  },
  assinatura_cancelada: {
    grupo: "inadimplencia",
    order: 2,
    tituloAmigavel: "Assinatura cancelada",
    quando:
      "Enviado depois que o cliente é inativado no TotalPass e a assinatura/fatura é cancelada no Asaas (fluxo de inadimplência).",
  },
  cobranca_gerada: {
    grupo: "cobranca",
    order: 1,
    tituloAmigavel: "Cobrança gerada",
    quando: "Enviado quando uma nova fatura/cobrança é criada.",
  },
  pagamento_confirmado: {
    grupo: "cobranca",
    order: 2,
    tituloAmigavel: "Pagamento confirmado",
    quando: "Enviado quando o Asaas confirma o pagamento.",
  },
  assinatura_criada: {
    grupo: "assinatura",
    order: 1,
    tituloAmigavel: "Assinatura criada",
    quando: "Enviado ao criar a assinatura mensal (com dados da 1ª cobrança).",
  },
  dependente_cobranca_iniciada: {
    grupo: "assinatura",
    order: 2,
    tituloAmigavel: "Dependente incluído na cobrança",
    quando: "Enviado quando um ou mais dependentes passam a ser cobrados na mensalidade.",
  },
  dependente_cobranca_parada: {
    grupo: "assinatura",
    order: 3,
    tituloAmigavel: "Dependente removido da cobrança",
    quando: "Enviado quando dependente(s) deixam de ser cobrados na mensalidade.",
  },
  dependente_cobranca_retomada: {
    grupo: "assinatura",
    order: 4,
    tituloAmigavel: "Dependente retomado na cobrança",
    quando: "Enviado quando a cobrança de dependente é reativada.",
  },
  bridge_offline_admin: {
    grupo: "admin",
    order: 1,
    tituloAmigavel: "Bridge offline (admin)",
    quando:
      "Alerta interno quando a extensão está offline e há inativações pendentes. WhatsApp (se Uazapi conectada) e/ou e-mail (Resend).",
  },
  uazapi_offline_admin: {
    grupo: "admin",
    order: 2,
    tituloAmigavel: "WhatsApp/Uazapi desconectado (admin)",
    quando:
      "E-mail/WhatsApp ao admin quando a Uazapi está offline (fila de clientes pausada). Disparado pelo cron de mensagens.",
  },
  bridge_job_failed_admin: {
    grupo: "admin",
    order: 3,
    tituloAmigavel: "Job de inativação falhou (admin)",
    quando:
      "Quando um job da ponte esgota tentativas. Se o erro parecer mudança de API do HR, o texto pede remapear.",
  },
  tp_integration_broken_admin: {
    grupo: "admin",
    order: 4,
    tituloAmigavel: "Integração TotalPass HR com erro (admin)",
    quando:
      "Quando a extensão reporta falha de sessão/API no heartbeat (possível mudança no painel HR).",
  },
};

export function getTemplateEventMeta(evento: string): TemplateEventMeta {
  return (
    TEMPLATE_EVENTS[evento] ?? {
      grupo: "outros",
      order: 99,
      tituloAmigavel: evento,
      quando: "Momento de envio não documentado.",
    }
  );
}

/** Texto “Quando” enriquecido com prazos da Bridge (carência / aviso). */
export function getTemplateQuandoText(
  evento: string,
  bridge?: { dias_carencia?: number; dias_aviso_final?: number } | null
): string {
  const meta = getTemplateEventMeta(evento);
  const carencia = bridge?.dias_carencia ?? 5;
  const aviso = bridge?.dias_aviso_final ?? 2;

  if (evento === "aviso_desvinculo_totalpass") {
    return `Enviado após ${carencia} dias de atraso (carência). Informa data e hora limite: mais ${aviso} dia(s) para pagar (até 23:59 desse dia). Se não pagar, segue a inativação no TotalPass.`;
  }
  if (evento === "assinatura_cancelada") {
    return `Enviado após inativar no TotalPass e cancelar a assinatura no Asaas (inadimplência: carência de ${carencia} dias + prazo do aviso).`;
  }
  return meta.quando;
}

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

  if (DESVINCULO_EVENTS.has(evento)) {
    return [
      ...base,
      "valor",
      "data_limite",
      "tem_plano_ativo",
      "mensagem_plano",
      "link_pagamento",
      "link_fatura",
    ];
  }

  if (evento === "bridge_offline_admin") {
    return ["pending_count", "ultimo_heartbeat"];
  }

  if (evento === "uazapi_offline_admin") {
    return ["status", "pending_count"];
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

/** Formata data limite do desvínculo com horário (fim do dia). */
export function formatDataLimiteComHora(isoDateYmd: string): string {
  const [y, m, d] = isoDateYmd.split("-");
  if (!y || !m || !d) return isoDateYmd;
  return `${d}/${m}/${y} às 23:59`;
}
