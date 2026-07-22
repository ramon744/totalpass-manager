export type UserRole = "admin" | "operador" | "visualizador";
export type PerfilBeneficiario = "titular" | "dependente";
export type StatusTotalpass = "ativo" | "elegivel" | "inativo";
/** Origem da cobrança recorrente do titular. Dependente usa `nenhum`. */
export type GatewayPagamento = "asaas" | "infinity" | "nenhum";
export type ImportacaoStatus = "processando" | "concluido" | "erro";
export type MensagemStatus = "pendente" | "enviando" | "enviado" | "erro";
export type TipoEnvioMensagem =
  | "texto"
  | "botao_pix"
  | "botao_link"
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
  gateway_pagamento: GatewayPagamento;
  infinity_customer_id: string | null;
  infinity_subscription_slug: string | null;
  observacoes: string | null;
  cobrar_na_assinatura: boolean;
  cobranca_manual_desativada_em: string | null;
  cobranca_manual_desativada_por: string | null;
  cobranca_manual_motivo: string | null;
  ultima_importacao_id: string | null;
  checkins_30d: number | null;
  checkins_periodo_inicio: string | null;
  checkins_periodo_fim: string | null;
  checkins_atualizado_em: string | null;
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
  /** Custo ao provedor; null/0 = sem custo por colaborador. */
  custo_colaborador?: number | null;
  /** Dia 1–28 da fatura do provedor; null se não houver. */
  dia_pagamento?: number | null;
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

/** Configuração da ponte extensão ↔ TotalPass (inativação por inadimplência). */
export interface ConfigBridge {
  dias_carencia?: number;
  dias_aviso_final?: number;
  heartbeat_ttl_minutos?: number;
  admin_telefone?: string;
  /** E-mail do admin para alerta de bridge offline (via Resend). */
  admin_email?: string;
  alerta_offline_intervalo_horas?: number;
  teto_diario_inativacoes?: number;
  notificar_cancelamento_asaas?: boolean;
  /**
   * Se false, o cron não avisa desvínculo automático nem enfileira jobs.
   * Manager/Asaas/WhatsApp de cobrança continuam normais (modo manual).
   */
  automacao_inativacao_ativa?: boolean;
}

export const DEFAULT_BRIDGE_CONFIG: Required<ConfigBridge> = {
  dias_carencia: 5,
  dias_aviso_final: 2,
  heartbeat_ttl_minutos: 15,
  admin_telefone: "",
  admin_email: "",
  alerta_offline_intervalo_horas: 2,
  teto_diario_inativacoes: 20,
  notificar_cancelamento_asaas: true,
  automacao_inativacao_ativa: true,
};

/**
 * InfinitePay (extensão + desvínculo). Tudo off/dry-run por padrão
 * para não interferir no Asaas até você ligar.
 */
export interface ConfigInfinity {
  /** Extensão Infinity pode fazer heartbeat/sync/jobs de escrita. */
  ativa?: boolean;
  /** Cron de aviso/desvínculo por atraso Infinity (fase 4). */
  automacao_desvinculo_ativa?: boolean;
  /** Se true, jobs de escrita não chamam a API Infinity de verdade. */
  dry_run?: boolean;
  heartbeat_ttl_minutos?: number;
  alerta_offline_intervalo_horas?: number;
  teto_diario_operacoes?: number;
  admin_telefone?: string;
  admin_email?: string;
  /** Segredo da extensão (ou use INFINITY_BRIDGE_SECRET no env). */
  bridge_secret?: string;
}

export const DEFAULT_INFINITY_CONFIG: Required<ConfigInfinity> = {
  ativa: false,
  automacao_desvinculo_ativa: false,
  dry_run: true,
  heartbeat_ttl_minutos: 15,
  alerta_offline_intervalo_horas: 2,
  teto_diario_operacoes: 20,
  admin_telefone: "",
  admin_email: "",
  bridge_secret: "",
};

export type BridgeJobTipo = "inactivate_totalpass";
export type BridgeJobStatus =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface BridgeInstance {
  id: string;
  installation_id: string;
  extension_version: string | null;
  last_seen_at: string;
  session_ok: boolean;
  session_email: string | null;
  pending_jobs_count: number;
  last_offline_alert_at: string | null;
  last_error: string | null;
  last_health_ok: boolean;
  created_at: string;
}

export interface BridgeJob {
  id: string;
  tipo: BridgeJobTipo;
  status: BridgeJobStatus;
  beneficiario_id: string;
  cpf: string;
  motivo: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  run_after: string;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DesvinculoAviso {
  id: string;
  beneficiario_id: string;
  cobranca_id: string;
  avisado_em: string;
  data_limite: string;
  created_at: string;
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

export interface InfinityFinanceiroStats {
  pendentes: number;
  vencidas: number;
  pagas: number;
  receitaPrevista: number;
  receitaRecebida: number;
  inadimplencia: number;
}

export interface DashboardStats {
  totalBeneficiarios: number;
  titulares: BeneficiarioResumo;
  dependentes: BeneficiarioResumo;
  provedores: ProvedorResumo[];
  /** Métricas Asaas (tabela cobrancas) — intactas. */
  assinaturasAtivas: number;
  cobrancasPendentes: number;
  cobrancasVencidas: number;
  receitaPrevista: number;
  receitaRecebida: number;
  inadimplencia: number;
  /** Só preenchido se infinity.ativa; ao desligar some do Dashboard. */
  infinityAtiva: boolean;
  infinity: InfinityFinanceiroStats | null;
}
