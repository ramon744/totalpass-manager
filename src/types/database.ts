export type UserRole = "admin" | "operador" | "visualizador";
export type PerfilBeneficiario = "titular" | "dependente";
export type StatusTotalpass = "ativo" | "elegivel" | "inativo";
export type ImportacaoStatus = "processando" | "concluido" | "erro";
export type MensagemStatus = "pendente" | "enviando" | "enviado" | "erro";
export type TipoEnvioMensagem =
  | "texto"
  | "botao_pix"
  | "botoes_pix_boleto"
  | "botoes_pagamento";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Beneficiario {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  perfil: PerfilBeneficiario;
  titular_id: string | null;
  provedor_id: string | null;
  status_totalpass: StatusTotalpass;
  plano: string | null;
  data_aderido_totalpass: string | null;
  data_cadastro_sistema: string;
  asaas_customer_id: string | null;
  observacoes: string | null;
  cobrar_na_assinatura: boolean;
  cobranca_manual_desativada_em: string | null;
  cobranca_manual_desativada_por: string | null;
  cobranca_manual_motivo: string | null;
  ultima_importacao_id: string | null;
  created_at: string;
  updated_at: string;
  dependentes?: Beneficiario[];
  provedor?: Provedor;
}

export interface Provedor {
  id: string;
  nome: string;
  beneficio: string | null;
  custo_colaborador: number | null;
  dia_pagamento: number | null;
  valor_cobrado_mensal: number | null;
  cobrar_dependentes: boolean;
  valor_dependente: number | null;
  mensagem_padrao: string | null;
  cadastro_completo: boolean;
  created_at: string;
  updated_at: string;
  beneficiarios?: Beneficiario[];
}

export interface ProvedorInput {
  nome: string;
  beneficio: string;
  custo_colaborador: number;
  dia_pagamento: number;
  valor_cobrado_mensal: number;
  cobrar_dependentes?: boolean;
  valor_dependente?: number | null;
  mensagem_padrao: string;
}

export interface Importacao {
  id: string;
  arquivo_nome: string;
  usuario_id: string | null;
  total_processados: number;
  total_criados: number;
  total_atualizados: number;
  total_inativados: number;
  total_erros: number;
  status: ImportacaoStatus;
  erros: ImportacaoErro[];
  created_at: string;
}

export interface ImportacaoErro {
  linha?: number;
  cpf?: string;
  nome?: string;
  mensagem: string;
}

export interface Assinatura {
  id: string;
  beneficiario_id: string;
  asaas_subscription_id: string;
  valor: number;
  dia_vencimento: number;
  proximo_vencimento: string | null;
  descricao: string | null;
  cobrar_dependentes: boolean;
  valor_titular: number | null;
  valor_dependentes: number;
  dependentes_cobrados: DependenteCobrancaSnapshot[];
  status: string;
  data_criacao: string;
  created_at: string;
  updated_at: string;
  beneficiario?: Beneficiario;
}

export interface DependenteCobrancaSnapshot {
  id: string;
  nome: string;
  status: StatusTotalpass;
  valor: number;
}

export interface Cobranca {
  id: string;
  beneficiario_id: string;
  assinatura_id: string | null;
  asaas_payment_id: string;
  valor: number;
  vencimento: string;
  data_pagamento: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  beneficiario?: Beneficiario;
}

export interface Mensagem {
  id: string;
  beneficiario_id: string | null;
  telefone: string;
  template_id: string | null;
  mensagem: string;
  tipo_envio: TipoEnvioMensagem;
  payload_envio: Record<string, string> | null;
  status: MensagemStatus;
  erro: string | null;
  tentativas: number;
  max_tentativas: number;
  agendado_para: string | null;
  proxima_tentativa_em: string | null;
  enviado_em: string | null;
  created_at: string;
  beneficiario?: Beneficiario;
}

export interface MensagemTemplate {
  id: string;
  evento: string;
  titulo: string;
  corpo: string;
  ativo: boolean;
  tipo_envio: TipoEnvioMensagem;
  max_tentativas: number;
  intervalo_retry_minutos: number[];
  updated_at: string;
}

export interface LogEntry {
  id: string;
  usuario_id: string | null;
  acao: string;
  entidade: string | null;
  entidade_id: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

export interface ConfigEmpresa {
  nome: string;
  cnpj: string;
  logo_url: string;
}

export interface ConfigFinanceiro {
  valor_mensalidade_padrao: number;
  dia_vencimento_padrao: number;
  descricao_padrao: string;
  /** BOLETO = boleto com opção PIX na fatura Asaas (padrão recomendado) */
  forma_pagamento_padrao?: "BOLETO" | "PIX" | "UNDEFINED";
}

export interface ConfigAsaas {
  api_key: string;
  ambiente: "sandbox" | "production";
  webhook_token?: string;
  webhook_url?: string;
}

export function getAsaasWebhookUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return `${base}/functions/v1/asaas-webhook`;
}

export interface ConfigUazapi {
  url: string;
  token: string;
  instancia: string;
  webhook_token?: string;
  webhook_url?: string;
  /** Nomes das etiquetas Uazapi que geram pré-cadastro (ex.: cliente totalpass). */
  etiquetas_monitoradas?: string[];
}

export interface PreCadastroWhatsapp {
  id: string;
  uazapi_chat_id: string;
  telefone: string;
  nome: string | null;
  cpf: string | null;
  email: string | null;
  etiquetas: string[];
  etiqueta_ids: string[];
  wa_notes: string | null;
  data_etiqueta: string;
  beneficiario_id: string | null;
  created_at: string;
  updated_at: string;
  beneficiario?: Pick<Beneficiario, "id" | "nome" | "cpf"> | null;
}

export const DEFAULT_ETIQUETAS_MONITORADAS = [
  "cliente totalpass",
  "cliente gympass",
] as const;

const DEFAULT_UAZAPI_WEBHOOK_TOKEN = "tp_uaz_wh_2026_K9mN2pQ7vR4sT8wX1zB5";

export function getUazapiWebhookUrl(webhookToken?: string) {
  if (process.env.UAZAPI_WEBHOOK_URL) {
    const url = new URL(process.env.UAZAPI_WEBHOOK_URL);
    const token = webhookToken || DEFAULT_UAZAPI_WEBHOOK_TOKEN;
    if (token && !url.searchParams.has("token")) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const url = new URL(`${base}/functions/v1/uazapi-webhook`);
  const token = webhookToken || DEFAULT_UAZAPI_WEBHOOK_TOKEN;
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export function getDefaultUazapiWebhookToken() {
  return process.env.UAZAPI_WEBHOOK_TOKEN || DEFAULT_UAZAPI_WEBHOOK_TOKEN;
}

/** Agendamento de lembretes WhatsApp (pg_cron + janela de envio). */
export interface ConfigCron {
  secret?: string;
  edge_function_url?: string;
  /** Hora (0–23, Brasília) em que o job diário monta a fila de lembretes. */
  hora_agendamento?: number;
  /** Minuto (0–59) do agendamento diário. */
  minuto_agendamento?: number;
  /** Início da janela — hora (Brasília). */
  janela_inicio?: number;
  /** Início da janela — minuto (Brasília). */
  janela_inicio_minuto?: number;
  /** Fim da janela — hora (Brasília). */
  janela_fim?: number;
  /** Fim da janela — minuto (Brasília). */
  janela_fim_minuto?: number;
}

export const DEFAULT_CRON_CONFIG: Required<
  Pick<
    ConfigCron,
    | "hora_agendamento"
    | "minuto_agendamento"
    | "janela_inicio"
    | "janela_inicio_minuto"
    | "janela_fim"
    | "janela_fim_minuto"
  >
> = {
  hora_agendamento: 8,
  minuto_agendamento: 0,
  janela_inicio: 8,
  janela_inicio_minuto: 0,
  janela_fim: 12,
  janela_fim_minuto: 0,
};

export interface BeneficiarioResumo {
  ativos: number;
  elegiveis: number;
  inativos: number;
  /** Ativos + elegíveis (exclui inativos), alinhado ao TotalPass */
  total: number;
}

export interface ProvedorResumo {
  id: string;
  nome: string;
  ativos: number;
  elegiveis: number;
  inativos: number;
  titularesAtivos: number;
  titularesElegiveis: number;
  dependentesAtivos: number;
  dependentesElegiveis: number;
  /** Ativos + elegíveis (exclui inativos), alinhado ao TotalPass */
  total: number;
  /** Todos os beneficiários do provedor, inclusive inativos */
  totalGeral: number;
}

export interface DashboardStats {
  totalBeneficiarios: number;
  titulares: BeneficiarioResumo;
  dependentes: BeneficiarioResumo;
  provedores: ProvedorResumo[];
  assinaturasAtivas: number;
  cobrancasPendentes: number;
  cobrancasVencidas: number;
  receitaPrevista: number;
  receitaRecebida: number;
  inadimplencia: number;
}
