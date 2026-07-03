import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AssinaturasList } from "@/components/assinaturas/assinaturas-list";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export const ASSINATURAS_PAGE_SIZE = 20;

function sanitizeIlikeTerm(value: string) {
  return value.trim().replace(/[%_]/g, "");
}

function buildAssinaturasPath(page: number, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/assinaturas${qs ? `?${qs}` : ""}`;
}

async function findBeneficiarioIdsBySearch(
  supabase: SupabaseClient,
  term: string
) {
  const digits = term.replace(/\D/g, "");
  const orParts = [`nome.ilike.%${term}%`, `telefone.ilike.%${term}%`];
  if (digits.length >= 3) {
    orParts.push(`cpf.ilike.%${digits}%`);
    if (digits !== term) {
      orParts.push(`telefone.ilike.%${digits}%`);
    }
  }

  const { data } = await supabase
    .from("beneficiarios")
    .select("id")
    .or(orParts.join(","));

  return [...new Set(data?.map((item) => item.id) ?? [])];
}

function orderBeneficiarioIdsByLatestAssinatura(
  rows: Array<{ beneficiario_id: string | null; created_at: string }>
) {
  const latestByBeneficiario = new Map<string, string>();

  for (const row of rows) {
    if (!row.beneficiario_id) continue;
    const current = latestByBeneficiario.get(row.beneficiario_id);
    if (!current || row.created_at > current) {
      latestByBeneficiario.set(row.beneficiario_id, row.created_at);
    }
  }

  return [...latestByBeneficiario.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id]) => id);
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

export default async function AssinaturasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = sanitizeIlikeTerm(params.q ?? "");

  const supabase = await createClient();

  let lightQuery = supabase
    .from("assinaturas")
    .select("beneficiario_id, created_at");

  if (q) {
    const beneficiarioIds = await findBeneficiarioIdsBySearch(supabase, q);
    if (beneficiarioIds.length === 0) {
      return (
        <DashboardShell title="Assinaturas">
          <RealtimeRefresher tables={["assinaturas", "beneficiarios"]} />
          <BackgroundSync tipo="subscriptions" />
          <AssinaturasList
            assinaturas={[]}
            beneficiarioOrdem={[]}
            pagination={{
              page: 1,
              totalPages: 1,
              total: 0,
              pageSize: ASSINATURAS_PAGE_SIZE,
            }}
            filtros={{ q }}
          />
        </DashboardShell>
      );
    }
    lightQuery = lightQuery.in("beneficiario_id", beneficiarioIds);
  }

  const { data: lightRows } = await lightQuery;
  const sortedBeneficiarioIds = orderBeneficiarioIdsByLatestAssinatura(
    lightRows ?? []
  );

  const total = sortedBeneficiarioIds.length;
  const totalPages = Math.max(1, Math.ceil(total / ASSINATURAS_PAGE_SIZE));

  if (total > 0 && page > totalPages) {
    redirect(buildAssinaturasPath(totalPages, q));
  }

  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * ASSINATURAS_PAGE_SIZE;
  const pageIds = sortedBeneficiarioIds.slice(from, from + ASSINATURAS_PAGE_SIZE);

  const { data: assinaturas } =
    pageIds.length > 0
      ? await supabase
          .from("assinaturas")
          .select("*, beneficiario:beneficiarios(*)")
          .in("beneficiario_id", pageIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  return (
    <DashboardShell title="Assinaturas">
      <RealtimeRefresher tables={["assinaturas", "beneficiarios"]} />
      <BackgroundSync tipo="subscriptions" />
      <AssinaturasList
        assinaturas={assinaturas ?? []}
        beneficiarioOrdem={pageIds}
        pagination={{
          page: safePage,
          totalPages,
          total,
          pageSize: ASSINATURAS_PAGE_SIZE,
        }}
        filtros={{ q }}
      />
    </DashboardShell>
  );
}
