import type { BeneficiarioResumo } from "@/types/database";

type Item = { perfil: string; status_totalpass: string };

export function buildBeneficiarioResumo(items: Item[]): BeneficiarioResumo {
  const ativos = items.filter((b) => b.status_totalpass === "ativo").length;
  const elegiveis = items.filter((b) => b.status_totalpass === "elegivel").length;
  const inativos = items.filter((b) => b.status_totalpass === "inativo").length;
  return { ativos, elegiveis, inativos, total: ativos + elegiveis };
}

export function resumoFromTitulares(
  titulares: Array<{ status_totalpass: string; dependentes: Array<{ status_totalpass: string }> }>
) {
  const titularesItems = titulares.map((t) => ({
    perfil: "titular",
    status_totalpass: t.status_totalpass,
  }));
  const dependentesItems = titulares.flatMap((t) =>
    t.dependentes.map((d) => ({
      perfil: "dependente",
      status_totalpass: d.status_totalpass,
    }))
  );
  return {
    titulares: buildBeneficiarioResumo(titularesItems),
    dependentes: buildBeneficiarioResumo(dependentesItems),
    totalBeneficiarios: titularesItems.length + dependentesItems.length,
  };
}
