import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PreCadastrosList } from "@/components/pre-cadastros/pre-cadastros-list";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const PRE_CADASTROS_PAGE_SIZE = 20;

function sanitizeSearchTerm(value: string) {
  return value.trim().replace(/[%_]/g, "");
}

function buildPreCadastrosPath(page: number, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/pre-cadastros${qs ? `?${qs}` : ""}`;
}

type PageProps = {
  searchParams: Promise<{ page?: string; q?: string }>;
};

export default async function PreCadastrosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = sanitizeSearchTerm(params.q ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let query = supabase
    .from("pre_cadastros_whatsapp")
    .select("*, beneficiario:beneficiarios(id, nome, cpf)", { count: "exact" })
    .order("data_etiqueta", { ascending: false });

  if (q) {
    const digits = q.replace(/\D/g, "");
    const orParts = [
      `nome.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `telefone.ilike.%${q}%`,
    ];
    if (digits.length >= 3) {
      orParts.push(`cpf.ilike.%${digits}%`, `telefone.ilike.%${digits}%`);
    }
    query = query.or(orParts.join(","));
  }

  const from = (page - 1) * PRE_CADASTROS_PAGE_SIZE;
  const to = from + PRE_CADASTROS_PAGE_SIZE - 1;

  const { data, count, error } = await query.range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PRE_CADASTROS_PAGE_SIZE));

  if (page > totalPages && total > 0) {
    redirect(buildPreCadastrosPath(totalPages, q));
  }

  return (
    <DashboardShell title="Pré-cadastros WhatsApp">
      <PreCadastrosList
        items={data ?? []}
        pagination={{
          page,
          totalPages,
          total,
          pageSize: PRE_CADASTROS_PAGE_SIZE,
        }}
        q={q}
      />
    </DashboardShell>
  );
}
