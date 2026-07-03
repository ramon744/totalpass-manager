import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { BeneficiariosList } from "@/components/beneficiarios/beneficiarios-list";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient } from "@/lib/supabase/server";
import { getFinanceiroConfig } from "@/lib/config";
import { toProvedoresMap } from "@/lib/assinatura-defaults";
import { resumoFromTitulares } from "@/lib/beneficiarios-resumo";
import {
  countBeneficiariosByFiltro,
  filterSortTitularesComDependentes,
  filterTitularesByFiltro,
  matchesPerson,
  type BeneficiarioFiltro,
  type BeneficiarioPerfilFiltro,
} from "@/lib/search";
import type { Beneficiario, Provedor } from "@/types/database";
import { redirect } from "next/navigation";

export const BENEFICIARIOS_PAGE_SIZE = 20;

const FILTROS_VALIDOS: BeneficiarioFiltro[] = [
  "todos",
  "ativo",
  "elegivel",
  "inativo",
  "titular",
  "dependente",
];

type BeneficiarioMinimal = Pick<
  Beneficiario,
  "id" | "perfil" | "titular_id" | "status_totalpass" | "nome" | "cpf" | "telefone"
>;

type TitularComDependentesMinimal = BeneficiarioMinimal & {
  dependentes: BeneficiarioMinimal[];
};

function parseFiltro(value: string | undefined): BeneficiarioFiltro {
  if (value && FILTROS_VALIDOS.includes(value as BeneficiarioFiltro)) {
    return value as BeneficiarioFiltro;
  }
  return "todos";
}

function parsePerfil(value: string | undefined): BeneficiarioPerfilFiltro {
  if (value === "titular" || value === "dependente") return value;
  return null;
}

function sanitizeSearchTerm(value: string) {
  return value.trim();
}

function buildBeneficiariosPath(
  page: number,
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro,
  q: string
) {
  const params = new URLSearchParams();
  if (filtro !== "todos") params.set("filtro", filtro);
  if (perfil) params.set("perfil", perfil);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/beneficiarios${qs ? `?${qs}` : ""}`;
}

function buildTitularesMinimal(
  beneficiarios: BeneficiarioMinimal[]
): TitularComDependentesMinimal[] {
  const titulares = beneficiarios.filter((b) => b.perfil === "titular");
  return titulares.map((titular) => ({
    ...titular,
    dependentes: beneficiarios.filter((d) => d.titular_id === titular.id),
  }));
}

function filterTitularesForList(
  titulares: TitularComDependentesMinimal[],
  filtro: BeneficiarioFiltro,
  perfil: BeneficiarioPerfilFiltro,
  q: string
) {
  let list = filterTitularesByFiltro(titulares, filtro, perfil);

  if (!q) return list;

  if (filtro === "titular") {
    return list.filter((t) => matchesPerson(t, q));
  }

  if (filtro === "dependente") {
    return list.filter((t) => t.dependentes.some((d) => matchesPerson(d, q)));
  }

  return filterSortTitularesComDependentes(list, q);
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    filtro?: string;
    perfil?: string;
    q?: string;
  }>;
};

export default async function BeneficiariosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const filtro = parseFiltro(params.filtro);
  const perfilFiltro = parsePerfil(params.perfil);
  const q = sanitizeSearchTerm(params.q ?? "");

  const supabase = await createClient();

  const [
    { data: beneficiariosMinimal },
    { data: assinaturasAtivas },
    { data: provedores },
    financeiro,
  ] = await Promise.all([
    supabase
      .from("beneficiarios")
      .select("id, perfil, titular_id, status_totalpass, nome, cpf, telefone")
      .order("nome"),
    supabase.from("assinaturas").select("beneficiario_id").eq("status", "ACTIVE"),
    supabase.from("provedores").select("*"),
    getFinanceiroConfig(supabase),
  ]);

  const provedoresById = toProvedoresMap((provedores ?? []) as Provedor[]);
  const comAssinatura = new Set(
    (assinaturasAtivas ?? []).map((a) => a.beneficiario_id)
  );

  const allTitularesMinimal = buildTitularesMinimal(
    (beneficiariosMinimal ?? []) as BeneficiarioMinimal[]
  );
  const contagem = countBeneficiariosByFiltro(allTitularesMinimal);
  const resumo = resumoFromTitulares(allTitularesMinimal);

  const filteredTitulares = filterTitularesForList(
    allTitularesMinimal,
    filtro,
    perfilFiltro,
    q
  );

  const total = filteredTitulares.length;
  const totalPages = Math.max(1, Math.ceil(total / BENEFICIARIOS_PAGE_SIZE));

  if (total > 0 && page > totalPages) {
    redirect(buildBeneficiariosPath(totalPages, filtro, perfilFiltro, q));
  }

  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * BENEFICIARIOS_PAGE_SIZE;
  const pageSlice = filteredTitulares.slice(from, from + BENEFICIARIOS_PAGE_SIZE);
  const pageIds = pageSlice.map((t) => t.id);

  let titulares: (Beneficiario & { dependentes: Beneficiario[] })[] = [];

  if (pageIds.length > 0) {
    const [{ data: pageTitularesFull }, { data: pageDependentesFull }] =
      await Promise.all([
        supabase.from("beneficiarios").select("*").in("id", pageIds),
        supabase.from("beneficiarios").select("*").in("titular_id", pageIds),
      ]);

    const titularesById = new Map(
      ((pageTitularesFull ?? []) as Beneficiario[]).map((t) => [t.id, t])
    );
    const dependentesByTitular = new Map<string, Beneficiario[]>();

    for (const dependente of (pageDependentesFull ?? []) as Beneficiario[]) {
      if (!dependente.titular_id) continue;
      const list = dependentesByTitular.get(dependente.titular_id) ?? [];
      list.push(dependente);
      dependentesByTitular.set(dependente.titular_id, list);
    }

    titulares = pageIds
      .map((id) => {
        const titular = titularesById.get(id);
        if (!titular) return null;
        return {
          ...titular,
          dependentes: dependentesByTitular.get(id) ?? [],
        };
      })
      .filter((item): item is Beneficiario & { dependentes: Beneficiario[] } =>
        item !== null
      );
  }

  return (
    <DashboardShell title="Beneficiários">
      <RealtimeRefresher tables={["beneficiarios", "assinaturas"]} />
      <BackgroundSync tipo="subscriptions" />
      <Suspense fallback={<p className="p-8 text-center text-slate-500">Carregando...</p>}>
        <BeneficiariosList
          titulares={titulares}
          comAssinatura={Array.from(comAssinatura)}
          contagem={contagem}
          resumo={resumo}
          defaults={{
            valor: financeiro?.valor_mensalidade_padrao ?? 16.99,
            dia: financeiro?.dia_vencimento_padrao ?? 10,
            descricao: financeiro?.descricao_padrao ?? "Mensalidade TotalPass",
          }}
          provedoresById={provedoresById}
          pagination={{
            page: safePage,
            totalPages,
            total,
            pageSize: BENEFICIARIOS_PAGE_SIZE,
          }}
          filtros={{ q, filtro, perfil: perfilFiltro }}
        />
      </Suspense>
    </DashboardShell>
  );
}
