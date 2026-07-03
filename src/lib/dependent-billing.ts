import type {
  Beneficiario,
  DependenteCobrancaSnapshot,
  Provedor,
} from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DependentBillingDefaults {
  valor: number;
  descricao: string;
}

export interface DependentBillingResult {
  cobrarDependentes: boolean;
  valorTitular: number;
  valorDependente: number;
  valorDependentes: number;
  valorTotal: number;
  dependentesCobrados: DependenteCobrancaSnapshot[];
  dependentesElegiveisFora: Beneficiario[];
  descricao: string;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function isDependenteCobravelPorStatus(dependente: Beneficiario) {
  return (
    dependente.status_totalpass === "ativo" ||
    dependente.status_totalpass === "elegivel"
  );
}

export function isTitularCobravelPorStatus(titular: Beneficiario) {
  return (
    titular.status_totalpass === "ativo" ||
    titular.status_totalpass === "elegivel"
  );
}

export function provedorCobraDependentes(
  provedor?: Pick<Provedor, "cobrar_dependentes" | "valor_dependente"> | null
) {
  return (
    Boolean(provedor?.cobrar_dependentes) &&
    Number(provedor?.valor_dependente ?? 0) > 0
  );
}

export function provedorTemValorDependente(
  provedor?: Pick<Provedor, "valor_dependente"> | null
) {
  return Number(provedor?.valor_dependente ?? 0) > 0;
}

/** Titular já possui dependente ativo/elegível marcado para cobrança. */
export function titularJaCobraDependentes(dependentes: Beneficiario[]) {
  return dependentes.some(
    (d) => d.cobrar_na_assinatura === true && isDependenteCobravelPorStatus(d)
  );
}

export async function titularJaCobraDependentesNoBanco(
  supabase: SupabaseClient,
  titularId: string
) {
  const { count } = await supabase
    .from("beneficiarios")
    .select("id", { count: "exact", head: true })
    .eq("titular_id", titularId)
    .eq("perfil", "dependente")
    .eq("cobrar_na_assinatura", true)
    .in("status_totalpass", ["ativo", "elegivel"]);

  return (count ?? 0) > 0;
}

export function dependenteFoiDesativadoManualmente(
  dependente: Pick<Beneficiario, "cobranca_manual_desativada_em">
) {
  return dependente.cobranca_manual_desativada_em != null;
}

/**
 * Se o titular já cobra algum dependente, inclui automaticamente os demais
 * ativos/elegíveis que nunca foram desativados manualmente.
 */
export async function syncCobrancaAutomaticaDependentesDoTitular(
  supabase: SupabaseClient,
  titularId: string
): Promise<string[]> {
  const jaCobra = await titularJaCobraDependentesNoBanco(supabase, titularId);
  if (!jaCobra) return [];

  const { data: paraIncluir } = await supabase
    .from("beneficiarios")
    .select("id")
    .eq("titular_id", titularId)
    .eq("perfil", "dependente")
    .eq("cobrar_na_assinatura", false)
    .is("cobranca_manual_desativada_em", null)
    .in("status_totalpass", ["ativo", "elegivel"]);

  if (!paraIncluir?.length) return [];

  const now = new Date().toISOString();
  const ids = paraIncluir.map((d) => d.id);

  await supabase
    .from("beneficiarios")
    .update({
      cobrar_na_assinatura: true,
      updated_at: now,
    })
    .in("id", ids);

  return ids;
}

/** Define se um dependente novo deve entrar na cobrança automaticamente. */
export function shouldAutoCobrarNovoDependente(params: {
  provedor?: Pick<Provedor, "cobrar_dependentes" | "valor_dependente"> | null;
  titularJaCobra: boolean;
  dependenteCobravel: boolean;
}) {
  if (!params.dependenteCobravel || !provedorTemValorDependente(params.provedor)) {
    return false;
  }
  return provedorCobraDependentes(params.provedor) || params.titularJaCobra;
}

/** Exibe controles de cobrança manual quando há valor configurado ou titular já cobra. */
export function permiteGestaoCobrancaDependentes(
  provedor: Pick<Provedor, "cobrar_dependentes" | "valor_dependente"> | null | undefined,
  dependentes: Beneficiario[]
) {
  return provedorTemValorDependente(provedor) || titularJaCobraDependentes(dependentes);
}

export function buildDependentBillingDescription(params: {
  baseDescricao: string;
  valorTitular: number;
  valorDependente: number;
  valorTotal: number;
  dependentesCobrados: DependenteCobrancaSnapshot[];
}) {
  const base = params.baseDescricao.trim() || "Mensalidade TotalPass";
  if (!params.dependentesCobrados.length) {
    return `${base} | Titular: R$ ${money(params.valorTitular)} | Total: R$ ${money(
      params.valorTotal
    )}`;
  }

  const nomes = params.dependentesCobrados.map((d) => d.nome).join(", ");
  return `${base} | Titular: R$ ${money(params.valorTitular)} | Dependentes (${params.dependentesCobrados.length} x R$ ${money(params.valorDependente)}): ${nomes} | Total: R$ ${money(params.valorTotal)}`;
}

export function calculateDependentBilling(params: {
  titular: Beneficiario;
  dependentes: Beneficiario[];
  provedor?: Provedor | null;
  defaults: DependentBillingDefaults;
  dependentesCobrancaIds?: string[] | null;
  valorDependenteFallback?: number;
}) : DependentBillingResult {
  const valorTitular =
    params.provedor?.valor_cobrado_mensal != null &&
    Number(params.provedor.valor_cobrado_mensal) > 0
      ? Number(params.provedor.valor_cobrado_mensal)
      : params.defaults.valor;

  const baseDescricao =
    params.provedor?.mensagem_padrao?.trim() || params.defaults.descricao;
  const valorDependente =
    params.provedor?.valor_dependente != null &&
    Number(params.provedor.valor_dependente) > 0
      ? Number(params.provedor.valor_dependente)
      : Number(params.valorDependenteFallback ?? 0) > 0
        ? Number(params.valorDependenteFallback)
        : 0;
  const titularCobravel = isTitularCobravelPorStatus(params.titular);

  const selected = params.dependentesCobrancaIds
    ? new Set(params.dependentesCobrancaIds)
    : null;

  const elegiveis = params.dependentes.filter(isDependenteCobravelPorStatus);
  const depsMarcados = elegiveis.filter((d) =>
    selected ? selected.has(d.id) : d.cobrar_na_assinatura === true
  );
  const podeCobrarDependentes =
    titularCobravel &&
    valorDependente > 0 &&
    (provedorCobraDependentes(params.provedor) ||
      depsMarcados.length > 0 ||
      titularJaCobraDependentes(params.dependentes));

  const dependentesCobrados = podeCobrarDependentes
    ? depsMarcados.map((d) => ({
        id: d.id,
        nome: d.nome,
        status: d.status_totalpass,
        valor: valorDependente,
      }))
    : [];

  const valorDependentes = dependentesCobrados.length * valorDependente;
  const valorTotal = valorTitular + valorDependentes;
  const cobrarDependentes = dependentesCobrados.length > 0;

  return {
    cobrarDependentes,
    valorTitular,
    valorDependente,
    valorDependentes,
    valorTotal,
    dependentesCobrados,
    dependentesElegiveisFora: podeCobrarDependentes
      ? elegiveis.filter((d) => !dependentesCobrados.some((c) => c.id === d.id))
      : [],
    descricao: buildDependentBillingDescription({
      baseDescricao,
      valorTitular,
      valorDependente,
      valorTotal,
      dependentesCobrados,
    }),
  };
}

export function diffDependentesCobrados(
  anteriores: DependenteCobrancaSnapshot[] | null | undefined,
  atuais: DependenteCobrancaSnapshot[]
) {
  const before = new Map((anteriores ?? []).map((d) => [d.id, d]));
  const after = new Map(atuais.map((d) => [d.id, d]));

  return {
    adicionados: atuais.filter((d) => !before.has(d.id)),
    removidos: (anteriores ?? []).filter((d) => !after.has(d.id)),
  };
}

export function formatDependentesCobranca(
  dependentes: Pick<DependenteCobrancaSnapshot, "nome">[]
) {
  if (!dependentes.length) return "nenhum dependente";
  if (dependentes.length === 1) return dependentes[0].nome;
  const nomes = dependentes.map((d) => d.nome);
  return `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

export function formatMoneyValue(value: number) {
  return money(value);
}
