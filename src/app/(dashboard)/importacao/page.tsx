import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ImportacaoPanel } from "@/components/importacao/importacao-panel";
import { createClient } from "@/lib/supabase/server";
import type { Provedor } from "@/types/database";
import { redirect } from "next/navigation";

export const IMPORTACAO_PAGE_SIZE = 20;

function buildImportacaoPath(page: number) {
  if (page <= 1) return "/importacao";
  return `/importacao?page=${page}`;
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
  }>;
};

export default async function ImportacaoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const supabase = await createClient();
  const from = (page - 1) * IMPORTACAO_PAGE_SIZE;
  const to = from + IMPORTACAO_PAGE_SIZE - 1;

  const [{ data: historico, count }, { data: provedores }] = await Promise.all([
    supabase
      .from("importacoes")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase.from("provedores").select("id, nome").order("nome"),
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / IMPORTACAO_PAGE_SIZE));

  if (total > 0 && page > totalPages) {
    redirect(buildImportacaoPath(totalPages));
  }

  const safePage = Math.min(page, totalPages);

  return (
    <DashboardShell title="Importação">
      <ImportacaoPanel
        historico={historico ?? []}
        provedores={(provedores ?? []) as Pick<Provedor, "id" | "nome">[]}
        pagination={{
          page: safePage,
          totalPages,
          total,
          pageSize: IMPORTACAO_PAGE_SIZE,
        }}
      />
    </DashboardShell>
  );
}
