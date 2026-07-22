import { DashboardShell } from "@/components/layout/dashboard-shell";
import { FinanceiroPanel } from "@/components/financeiro/financeiro-panel";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BackgroundSync } from "@/components/background-sync";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getFinanceiroConfig } from "@/lib/config";
import { toProvedoresMap } from "@/lib/assinatura-defaults";
import type { Beneficiario, PreCadastroWhatsapp, Provedor } from "@/types/database";

function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export default async function FinanceiroPage() {
  const supabase = await createClient();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  const [
    { data: beneficiariosCobraveis },
    { data: assinaturasAtivas },
    { data: provedores },
    { data: preCadastros },
    { data: infinityRows },
    { data: infinityJobs },
    financeiro,
  ] = await Promise.all([
    supabase
      .from("beneficiarios")
      .select("*")
      .neq("status_totalpass", "inativo")
      .order("nome"),
    supabase.from("assinaturas").select("beneficiario_id").eq("status", "ACTIVE"),
    supabase.from("provedores").select("*"),
    supabase
      .from("pre_cadastros_whatsapp")
      .select("*")
      .order("data_etiqueta", { ascending: false }),
    service
      .from("infinity_customer_status")
      .select("beneficiario_id, document_number, payment_status, nome")
      .limit(500),
    service
      .from("infinity_jobs")
      .select("id, beneficiario_id, status, last_error, updated_at")
      .eq("tipo", "create_charge")
      .in("status", ["pending", "claimed", "running", "failed"])
      .order("updated_at", { ascending: false })
      .limit(200),
    getFinanceiroConfig(supabase),
  ]);

  const provedoresById = toProvedoresMap((provedores ?? []) as Provedor[]);

  const comAssinatura = new Set(
    (assinaturasAtivas ?? []).map((a) => a.beneficiario_id)
  );

  const infinityByBeneficiarioId = new Set<string>();
  const infinityByCpf = new Map<
    string,
    { payment_status: string; nome: string | null }
  >();

  for (const row of infinityRows ?? []) {
    if (row.beneficiario_id) {
      infinityByBeneficiarioId.add(row.beneficiario_id);
    }
    const cpf = digitsOnly(row.document_number);
    if (cpf.length >= 11) {
      infinityByCpf.set(cpf, {
        payment_status: row.payment_status,
        nome: row.nome,
      });
    }
  }

  const jobByBeneficiario = new Map<
    string,
    { status: string; last_error: string | null }
  >();
  for (const j of infinityJobs ?? []) {
    if (!j.beneficiario_id || jobByBeneficiario.has(j.beneficiario_id)) continue;
    jobByBeneficiario.set(j.beneficiario_id, {
      status: j.status,
      last_error: j.last_error,
    });
  }

  const titulares = (beneficiariosCobraveis ?? [])
    .filter((b) => b.perfil === "titular")
    .map((t) => ({
      ...(t as Beneficiario),
      dependentes: (beneficiariosCobraveis ?? []).filter(
        (d) => d.titular_id === t.id
      ) as Beneficiario[],
    }));

  /**
   * Só esconde do Financeiro quem REALMENTE tem cobrança Infinity
   * (id do cliente ou snapshot de sync). Gateway=infinity sem id = limbo → lista.
   */
  function jaCobertoInfinity(t: Beneficiario) {
    if (t.infinity_customer_id) return true;
    if (infinityByBeneficiarioId.has(t.id)) return true;
    const cpf = digitsOnly(t.cpf);
    if (cpf && infinityByCpf.has(cpf)) return true;
    return false;
  }

  const ocultosInfinity = titulares.filter(
    (b) => !comAssinatura.has(b.id) && jaCobertoInfinity(b)
  ).length;

  const pendentes = titulares
    .filter((b) => !comAssinatura.has(b.id) && !jaCobertoInfinity(b))
    .map((t) => {
      const cpf = digitsOnly(t.cpf);
      const hint = cpf ? infinityByCpf.get(cpf) : undefined;
      const job = jobByBeneficiario.get(t.id);
      const gatewaySugerido =
        t.gateway_pagamento === "infinity" || hint || job
          ? ("infinity" as const)
          : ("asaas" as const);
      return {
        ...t,
        gatewaySugerido,
        infinityHint: hint
          ? {
              payment_status: hint.payment_status,
              nome: hint.nome,
            }
          : null,
        infinityJobStatus: job?.status ?? null,
        infinityJobError: job?.last_error ?? null,
      };
    });

  return (
    <DashboardShell title="Clientes Pendentes de Cobrança">
      <RealtimeRefresher
        tables={[
          "beneficiarios",
          "assinaturas",
          "infinity_customer_status",
          "infinity_jobs",
        ]}
      />
      <BackgroundSync tipo="subscriptions" />
      <FinanceiroPanel
        pendentes={pendentes}
        preCadastros={(preCadastros ?? []) as PreCadastroWhatsapp[]}
        defaults={{
          valor: financeiro?.valor_mensalidade_padrao ?? 16.99,
          dia: financeiro?.dia_vencimento_padrao ?? 10,
          descricao: financeiro?.descricao_padrao ?? "Mensalidade TotalPass",
        }}
        provedoresById={provedoresById}
        ocultosInfinity={ocultosInfinity}
      />
    </DashboardShell>
  );
}
