import { DashboardShell } from "@/components/layout/dashboard-shell";
import { MensagensPanel } from "@/components/mensagens/mensagens-panel";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export const MENSAGENS_PAGE_SIZE = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeIlikeTerm(value: string) {
  return value.trim().replace(/[%_]/g, "");
}

function buildMensagensPath(
  de: string,
  ate: string,
  page: number,
  pessoa: string,
  q: string
) {
  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  if (pessoa) params.set("pessoa", pessoa);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/mensagens${qs ? `?${qs}` : ""}`;
}

async function findBeneficiarioIdsByTerm(
  supabase: SupabaseClient,
  term: string
) {
  const { data } = await supabase
    .from("beneficiarios")
    .select("id")
    .or(`nome.ilike.%${term}%,telefone.ilike.%${term}%`);

  return data?.map((item) => item.id) ?? [];
}

type PageProps = {
  searchParams: Promise<{
    page?: string;
    de?: string;
    ate?: string;
    pessoa?: string;
    q?: string;
  }>;
};

export default async function MensagensPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const de = params.de?.trim() ?? "";
  const ate = params.ate?.trim() ?? "";
  const pessoa = params.pessoa?.trim() ?? "";
  const q = sanitizeIlikeTerm(params.q ?? "");

  const supabase = await createClient();
  const pessoaValida = pessoa && UUID_RE.test(pessoa) ? pessoa : "";

  let mensagensQuery = supabase
    .from("mensagens")
    .select("*, beneficiario:beneficiarios(*)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (de) {
    mensagensQuery = mensagensQuery.gte("created_at", `${de}T00:00:00`);
  }
  if (ate) {
    mensagensQuery = mensagensQuery.lte("created_at", `${ate}T23:59:59`);
  }
  if (pessoaValida) {
    mensagensQuery = mensagensQuery.eq("beneficiario_id", pessoaValida);
  }

  if (q) {
    if (pessoaValida) {
      const digits = q.replace(/\D/g, "");
      const phoneTerm = digits.length >= 3 ? digits : q;
      mensagensQuery = mensagensQuery.ilike("telefone", `%${phoneTerm}%`);
    } else {
      const ids = await findBeneficiarioIdsByTerm(supabase, q);
      const orParts = [`telefone.ilike.%${q}%`];
      const digits = q.replace(/\D/g, "");
      if (digits.length >= 3 && digits !== q) {
        orParts.push(`telefone.ilike.%${digits}%`);
      }
      if (ids.length > 0) {
        orParts.push(`beneficiario_id.in.(${ids.join(",")})`);
      }
      mensagensQuery = mensagensQuery.or(orParts.join(","));
    }
  }

  const from = (page - 1) * MENSAGENS_PAGE_SIZE;
  const to = from + MENSAGENS_PAGE_SIZE - 1;

  const [
    { data: mensagens, count },
    { data: templates },
    { data: clientes },
    { data: pessoas },
  ] = await Promise.all([
    mensagensQuery.range(from, to),
    supabase.from("mensagem_templates").select("*").order("evento"),
    supabase
      .from("beneficiarios")
      .select("id, nome, telefone, cpf")
      .eq("perfil", "titular")
      .order("nome"),
    supabase
      .from("beneficiarios")
      .select("id, nome, telefone")
      .order("nome"),
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / MENSAGENS_PAGE_SIZE));

  if (total > 0 && page > totalPages) {
    redirect(buildMensagensPath(de, ate, totalPages, pessoaValida, q));
  }

  const safePage = Math.min(page, totalPages);

  return (
    <DashboardShell title="Mensagens WhatsApp">
      <MensagensPanel
        mensagens={mensagens ?? []}
        templates={templates ?? []}
        clientes={clientes ?? []}
        pessoas={pessoas ?? []}
        pagination={{
          page: safePage,
          totalPages,
          total,
          pageSize: MENSAGENS_PAGE_SIZE,
        }}
        filtros={{ de, ate, pessoa: pessoaValida, q }}
      />
    </DashboardShell>
  );
}
