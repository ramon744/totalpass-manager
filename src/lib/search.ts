import { normalizeCpf } from "@/lib/utils";

export interface SearchablePerson {
  nome: string;
  cpf: string;
  telefone?: string | null;
}

export function normalizeSearchQuery(query: string) {
  return query.trim().toLowerCase();
}

export function searchDigits(query: string) {
  return query.replace(/\D/g, "");
}

export function normalizePhoneDigits(phone: string | null | undefined) {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

export function matchesPhone(
  telefone: string | null | undefined,
  query: string
): boolean {
  const queryDigits = searchDigits(query);
  if (!queryDigits) return false;
  const phoneDigits = normalizePhoneDigits(telefone);
  if (!phoneDigits) return false;
  return phoneDigits.includes(queryDigits);
}

export function matchesNomeCpf(
  nome: string,
  cpf: string,
  query: string,
  telefone?: string | null
): boolean {
  const q = normalizeSearchQuery(query);
  if (!q && !searchDigits(query)) return true;
  if (q && nome.toLowerCase().includes(q)) return true;
  const digits = searchDigits(query);
  if (digits && normalizeCpf(cpf).includes(digits)) return true;
  if (telefone && matchesPhone(telefone, query)) return true;
  return false;
}

export function matchesPerson(person: SearchablePerson, query: string): boolean {
  return matchesNomeCpf(person.nome, person.cpf, query, person.telefone);
}

/** Quanto maior, melhor o match (para ordenar resultados no topo). */
export function scoreNomeCpf(
  nome: string,
  cpf: string,
  query: string,
  telefone?: string | null
): number {
  const q = normalizeSearchQuery(query);
  const queryDigits = searchDigits(query);
  if (!q && !queryDigits) return 0;

  const nomeLower = nome.toLowerCase();
  const cpfDigits = normalizeCpf(cpf);
  const phoneDigits = normalizePhoneDigits(telefone);
  let score = 0;

  if (q) {
    if (nomeLower === q) score = Math.max(score, 1000);
    else if (nomeLower.startsWith(q)) score = Math.max(score, 500);
    else if (nomeLower.includes(q)) score = Math.max(score, 300);
  }

  if (queryDigits) {
    if (cpfDigits === queryDigits) score = Math.max(score, 900);
    else if (cpfDigits.startsWith(queryDigits)) score = Math.max(score, 400);
    else if (cpfDigits.includes(queryDigits)) score = Math.max(score, 200);

    if (phoneDigits) {
      if (phoneDigits === queryDigits) score = Math.max(score, 950);
      else if (phoneDigits.startsWith(queryDigits)) score = Math.max(score, 450);
      else if (phoneDigits.includes(queryDigits)) score = Math.max(score, 250);
    }
  }

  return score;
}

export function scorePerson(person: SearchablePerson, query: string): number {
  return scoreNomeCpf(person.nome, person.cpf, query, person.telefone);
}

export function groupSearchScore(
  person: SearchablePerson,
  dependentes: SearchablePerson[],
  query: string
): number {
  const self = scorePerson(person, query);
  const depMax = dependentes.reduce(
    (max, d) => Math.max(max, scorePerson(d, query)),
    0
  );
  return Math.max(self, depMax);
}

export function sortBySearchScore<T>(
  items: T[],
  query: string,
  scoreFn: (item: T, query: string) => number
): T[] {
  if (!query.trim()) return items;
  return [...items].sort((a, b) => scoreFn(b, query) - scoreFn(a, query));
}

export function filterSortTitularesComDependentes<
  T extends SearchablePerson & { dependentes: SearchablePerson[] },
>(titulares: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return titulares;

  const filtered = titulares.filter(
    (t) =>
      matchesPerson(t, q) || t.dependentes.some((d) => matchesPerson(d, q))
  );

  return sortBySearchScore(filtered, q, (t) =>
    groupSearchScore(t, t.dependentes, q)
  );
}

export type BeneficiarioFiltro =
  | "todos"
  | "ativo"
  | "elegivel"
  | "inativo"
  | "titular"
  | "dependente";

export function countBeneficiariosByFiltro<
  T extends { status_totalpass: string; dependentes: { status_totalpass: string }[] },
>(titulares: T[]) {
  const dependentes = titulares.flatMap((t) => t.dependentes);
  const countStatus = (status: string) =>
    titulares.filter((t) => t.status_totalpass === status).length +
    dependentes.filter((d) => d.status_totalpass === status).length;

  return {
    todos: titulares.length + dependentes.length,
    ativo: countStatus("ativo"),
    elegivel: countStatus("elegivel"),
    inativo: countStatus("inativo"),
    titular: titulares.length,
    dependente: dependentes.length,
  };
}

export type BeneficiarioPerfilFiltro = "titular" | "dependente" | null;

export function filterTitularesByFiltro<
  T extends { status_totalpass: string; dependentes: { status_totalpass: string }[] },
>(titulares: T[], filtro: BeneficiarioFiltro, perfil: BeneficiarioPerfilFiltro = null): T[] {
  if (perfil === "titular") {
    if (filtro === "titular" || filtro === "todos") return titulares;
    if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
      return titulares.filter((t) => t.status_totalpass === filtro);
    }
  }

  if (perfil === "dependente") {
    if (filtro === "dependente" || filtro === "todos") {
      return titulares.filter((t) => t.dependentes.length > 0);
    }
    if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
      return titulares.filter((t) =>
        t.dependentes.some((d) => d.status_totalpass === filtro)
      );
    }
  }

  if (filtro === "todos" || filtro === "titular") return titulares;
  if (filtro === "dependente") {
    return titulares.filter((t) => t.dependentes.length > 0);
  }
  return titulares.filter(
    (t) =>
      t.status_totalpass === filtro ||
      t.dependentes.some((d) => d.status_totalpass === filtro)
  );
}

export function getDependentesByFiltro<T extends { status_totalpass: string }>(
  dependentes: T[],
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro = null
): T[] {
  if (perfil === "titular") return [];

  if (perfil === "dependente") {
    if (filtro === "dependente" || filtro === "todos") return dependentes;
    if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
      return dependentes.filter((d) => d.status_totalpass === filtro);
    }
  }

  if (filtro === "titular") return [];
  if (filtro === "dependente" || filtro === "todos") return dependentes;
  return dependentes.filter((d) => d.status_totalpass === filtro);
}

export function shouldRenderTitularRow(
  titular: { status_totalpass: string },
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro = null
): boolean {
  if (perfil === "dependente") return false;

  if (perfil === "titular") {
    if (filtro === "titular" || filtro === "todos") return true;
    if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
      return titular.status_totalpass === filtro;
    }
  }

  if (filtro === "dependente") return false;
  if (filtro === "titular" || filtro === "todos") return true;
  return titular.status_totalpass === filtro;
}

export function shouldAutoExpandTitular(
  titular: { status_totalpass: string; dependentes: { status_totalpass: string }[] },
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro = null
): boolean {
  if (perfil === "dependente") return true;

  if (perfil === "titular") return false;

  if (filtro === "dependente") return true;
  if (filtro === "ativo" || filtro === "elegivel" || filtro === "inativo") {
    const titularMatches = titular.status_totalpass === filtro;
    const hasMatchingDeps = titular.dependentes.some(
      (d) => d.status_totalpass === filtro
    );
    return !titularMatches && hasMatchingDeps;
  }
  return false;
}

export function getVisibleDependentes<T extends SearchablePerson>(
  titular: SearchablePerson & { dependentes: T[] },
  query: string
): T[] {
  const q = query.trim();
  if (!q) return titular.dependentes;

  const titularMatches = matchesPerson(titular, q);
  const deps = titularMatches
    ? titular.dependentes
    : titular.dependentes.filter((d) => matchesPerson(d, q));

  return sortBySearchScore(deps, q, (d) => scorePerson(d, q));
}

export function filterSortProvedores<
  P extends {
    nome: string;
    titulares: (SearchablePerson & { dependentes: SearchablePerson[] })[];
  },
>(provedores: P[], query: string): P[] {
  const q = query.trim();
  if (!q) return provedores;
  const qLower = normalizeSearchQuery(q);

  const filtered = provedores.filter(
    (p) =>
      p.nome.toLowerCase().includes(qLower) ||
      p.titulares.some(
        (t) =>
          matchesPerson(t, q) || t.dependentes.some((d) => matchesPerson(d, q))
      )
  );

  return sortBySearchScore(filtered, q, (p) => {
    const companyScore = p.nome.toLowerCase().includes(qLower) ? 600 : 0;
    const empMax = Math.max(
      0,
      ...p.titulares.map((t) => groupSearchScore(t, t.dependentes, q))
    );
    return Math.max(companyScore, empMax);
  });
}

export function titularesComMatchEmDependente<
  T extends SearchablePerson & { id: string; dependentes: SearchablePerson[] },
>(titulares: T[], query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  return titulares
    .filter(
      (t) =>
        !matchesPerson(t, q) && t.dependentes.some((d) => matchesPerson(d, q))
    )
    .map((t) => t.id);
}

export function provedoresComMatchEmFuncionario<
  P extends {
    id: string;
    nome: string;
    titulares: (SearchablePerson & { dependentes: SearchablePerson[] })[];
  },
>(provedores: P[], query: string): string[] {
  const q = query.trim();
  const qLower = normalizeSearchQuery(q);
  if (!q) return [];

  return provedores
    .filter((p) => {
      if (p.nome.toLowerCase().includes(qLower)) return false;
      return p.titulares.some(
        (t) =>
          matchesPerson(t, q) || t.dependentes.some((d) => matchesPerson(d, q))
      );
    })
    .map((p) => p.id);
}
