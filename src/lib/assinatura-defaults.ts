import { calculateDependentBilling } from "@/lib/dependent-billing";
import type { Beneficiario, Provedor } from "@/types/database";

export interface AssinaturaDefaults {
  valor: number;
  dia: number;
  descricao: string;
  cobrarDependentes?: boolean;
  valorTitular?: number;
  valorDependente?: number;
  valorDependentes?: number;
  dependentesCobrancaIds?: string[];
}

export function toProvedoresMap(
  provedores: Provedor[]
): Map<string, Provedor> {
  return new Map(provedores.map((p) => [p.id, p]));
}

/** Resolve valor e descrição do provedor vinculado, com fallback nas configs globais. */
export function resolveAssinaturaDefaults(
  beneficiario:
    | ({ provedor_id: string | null } & Partial<Beneficiario>)
    | null
    | undefined,
  provedoresById: Map<string, Provedor>,
  global: AssinaturaDefaults
): AssinaturaDefaults {
  if (!beneficiario?.provedor_id) return global;

  const provedor = provedoresById.get(beneficiario.provedor_id);
  if (!provedor) return global;

  const valor =
    provedor.valor_cobrado_mensal != null && Number(provedor.valor_cobrado_mensal) > 0
      ? Number(provedor.valor_cobrado_mensal)
      : global.valor;

  const dependentes = (beneficiario?.dependentes ?? []) as Beneficiario[];
  if (beneficiario && dependentes.length > 0) {
    const calculated = calculateDependentBilling({
      titular: beneficiario as Beneficiario,
      dependentes,
      provedor,
      defaults: global,
    });

    return {
      valor: calculated.valorTotal,
      dia: global.dia,
      descricao: calculated.descricao,
      cobrarDependentes: calculated.cobrarDependentes,
      valorTitular: calculated.valorTitular,
      valorDependente: calculated.valorDependente,
      valorDependentes: calculated.valorDependentes,
      dependentesCobrancaIds: calculated.dependentesCobrados.map((d) => d.id),
    };
  }

  const descricao = provedor.mensagem_padrao?.trim() || global.descricao;

  return {
    valor,
    dia: global.dia,
    descricao,
    cobrarDependentes: Boolean(provedor.cobrar_dependentes),
    valorTitular: valor,
    valorDependente: Number(provedor.valor_dependente) || 0,
    valorDependentes: 0,
    dependentesCobrancaIds: [],
  };
}

/** Para lote: usa defaults do provedor só se todos os selecionados forem iguais. */
export function resolveBulkAssinaturaDefaults(
  beneficiarios: { provedor_id: string | null }[],
  provedoresById: Map<string, Provedor>,
  global: AssinaturaDefaults
): AssinaturaDefaults {
  if (!beneficiarios.length) return global;

  const resolved = beneficiarios.map((b) =>
    resolveAssinaturaDefaults(b, provedoresById, global)
  );
  const first = resolved[0];
  const allSame = resolved.every(
    (r) => r.valor === first.valor && r.descricao === first.descricao
  );

  return allSame ? first : global;
}
