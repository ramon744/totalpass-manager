import type { SupabaseClient } from "@supabase/supabase-js";
import { createLog } from "@/lib/logger";
import { getBrazilDateString, getBrazilDayStartUtcIso } from "@/lib/services/reminder-schedule";
import {
  drainMessageQueue,
  scheduleMessage,
} from "@/lib/services/messages";
import { buildPaymentTemplateVars } from "@/lib/services/payment-message-vars";
import {
  cancelBridgeJobsForBeneficiario,
  enqueueBridgeJob,
  getBridgeConfig,
  getBridgeHealthStatus,
  isBeneficiarioDesvinculoConcluido,
  reclaimStaleBridgeJobs,
} from "@/lib/services/bridge-jobs";
import { formatDataLimiteComHora } from "@/lib/message-templates";

function addDaysIso(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatBrDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export type DesvinculoPendenteManual = {
  avisoId: string;
  beneficiarioId: string;
  nome: string;
  cpf: string;
  cobrancaId: string;
  dataLimite: string;
  valor: number;
  vencimento: string;
  statusTotalpass: string;
  temAssinaturaAtiva: boolean;
  gateway?: "asaas" | "infinity";
};

/**
 * Avisos com data_limite vencida que ainda precisam de desvínculo
 * (bridge offline ou fila ainda não processou).
 */
export async function listDesvinculosPendentesManuais(
  supabase: SupabaseClient,
  limit = 50
): Promise<DesvinculoPendenteManual[]> {
  const today = getBrazilDateString(new Date());
  const out: DesvinculoPendenteManual[] = [];
  const perSource = Math.max(1, Math.min(50, Math.ceil(limit / 2)));

  const { data: avisos, error } = await supabase
    .from("desvinculo_avisos")
    .select(
      "id, beneficiario_id, cobranca_id, data_limite, beneficiario:beneficiarios!inner(id, nome, cpf, perfil, status_totalpass), cobranca:cobrancas!inner(id, valor, vencimento, status)"
    )
    .lte("data_limite", today)
    .order("data_limite", { ascending: true })
    .limit(perSource);

  if (error) throw new Error(error.message);

  for (const aviso of avisos ?? []) {
    const ben = aviso.beneficiario as unknown as {
      id: string;
      nome: string;
      cpf: string;
      perfil: string;
      status_totalpass: string;
    };
    const cob = aviso.cobranca as unknown as {
      id: string;
      valor: number;
      vencimento: string;
      status: string;
    };

    if (!ben || ben.perfil !== "titular") continue;
    if (cob?.status !== "OVERDUE") continue;

    const concluido = await isBeneficiarioDesvinculoConcluido(supabase, ben.id);
    if (concluido) continue;

    const { data: assinaturaAtiva } = await supabase
      .from("assinaturas")
      .select("id")
      .eq("beneficiario_id", ben.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    out.push({
      avisoId: aviso.id,
      beneficiarioId: ben.id,
      nome: ben.nome,
      cpf: ben.cpf,
      cobrancaId: cob.id,
      dataLimite: aviso.data_limite,
      valor: Number(cob.valor),
      vencimento: String(cob.vencimento).slice(0, 10),
      statusTotalpass: ben.status_totalpass,
      temAssinaturaAtiva: Boolean(assinaturaAtiva),
      gateway: "asaas",
    });
  }

  const { data: infAvisos, error: infErr } = await supabase
    .from("infinity_desvinculo_avisos")
    .select(
      "id, beneficiario_id, infinity_customer_id, data_limite, beneficiario:beneficiarios!inner(id, nome, cpf, perfil, status_totalpass, gateway_pagamento)"
    )
    .lte("data_limite", today)
    .order("data_limite", { ascending: true })
    .limit(perSource);

  if (infErr) throw new Error(infErr.message);

  for (const aviso of infAvisos ?? []) {
    const ben = aviso.beneficiario as unknown as {
      id: string;
      nome: string;
      cpf: string;
      perfil: string;
      status_totalpass: string;
      gateway_pagamento?: string | null;
    };
    if (!ben || ben.perfil !== "titular") continue;
    if ((ben.gateway_pagamento ?? "asaas") !== "infinity") continue;

    const concluido = await isBeneficiarioDesvinculoConcluido(supabase, ben.id);
    if (concluido) continue;

    const { data: statusRow } = await supabase
      .from("infinity_customer_status")
      .select("amount, due_date, payment_status")
      .eq("infinity_customer_id", aviso.infinity_customer_id)
      .maybeSingle();

    if (statusRow?.payment_status !== "overdue") continue;

    const { data: assinaturaAtiva } = await supabase
      .from("assinaturas")
      .select("id")
      .eq("beneficiario_id", ben.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    out.push({
      avisoId: aviso.id,
      beneficiarioId: ben.id,
      nome: ben.nome,
      cpf: ben.cpf,
      cobrancaId: `infinity:${aviso.infinity_customer_id}`,
      dataLimite: aviso.data_limite,
      valor: statusRow?.amount != null ? Number(statusRow.amount) : 0,
      vencimento: statusRow?.due_date
        ? String(statusRow.due_date).slice(0, 10)
        : aviso.data_limite,
      statusTotalpass: ben.status_totalpass,
      temAssinaturaAtiva: Boolean(assinaturaAtiva),
      gateway: "infinity",
    });
  }

  return out
    .sort((a, b) => a.dataLimite.localeCompare(b.dataLimite))
    .slice(0, limit);
}

/**
 * Detecta inadimplência, avisa beneficiário e enfileira inativação no TotalPass.
 *
 * - Aviso WhatsApp: mesmo com bridge offline (desde que automação permitida).
 * - Enfileirar job: só com bridge online.
 * - Já desvinculado manual: não enfileira; cancela jobs órfãos.
 */
export async function processOverdueInactivations(supabase: SupabaseClient) {
  const bridge = await getBridgeConfig(supabase);
  const dryRun = process.env.BRIDGE_INACTIVATION_DRY_RUN === "true";

  if (!bridge.automacao_inativacao_ativa) {
    return {
      dryRun,
      scanned: 0,
      avisados: 0,
      enfileirados: 0,
      aguardandoManual: 0,
      skipped: 0,
      errors: [] as string[],
      paused: true,
      reason: "automacao_inativacao_desligada",
    };
  }

  const health = await getBridgeHealthStatus(supabase, bridge);
  const bridgeOnline = health.online;

  if (bridgeOnline) {
    await reclaimStaleBridgeJobs(
      supabase,
      Math.max(25, bridge.heartbeat_ttl_minutos * 2)
    );
  }

  const today = getBrazilDateString(new Date());
  const dayStartIso = getBrazilDayStartUtcIso(new Date());
  const carenciaCutoff = addDaysIso(today, -bridge.dias_carencia);

  const { count: succeededToday } = await supabase
    .from("bridge_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "succeeded")
    .eq("motivo", "inadimplencia")
    .gte("completed_at", dayStartIso);

  let remainingDailyCap = Math.max(
    0,
    bridge.teto_diario_inativacoes - (succeededToday ?? 0)
  );

  const { count: pendingToday } = await supabase
    .from("bridge_jobs")
    .select("id", { count: "exact", head: true })
    .eq("motivo", "inadimplencia")
    .in("status", ["pending", "claimed", "running"])
    .gte("created_at", dayStartIso);

  remainingDailyCap = Math.max(0, remainingDailyCap - (pendingToday ?? 0));

  const { data: overdue, error } = await supabase
    .from("cobrancas")
    .select(
      "id, beneficiario_id, asaas_payment_id, valor, vencimento, status, beneficiario:beneficiarios!inner(id, nome, cpf, telefone, perfil, status_totalpass, gateway_pagamento)"
    )
    .eq("status", "OVERDUE")
    .lte("vencimento", carenciaCutoff)
    .order("vencimento", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const summary = {
    dryRun,
    scanned: overdue?.length ?? 0,
    avisados: 0,
    enfileirados: 0,
    aguardandoManual: 0,
    skipped: 0,
    errors: [] as string[],
    bridgeOnline,
    bridgeHealthReason: health.reason,
  };

  for (const cob of overdue ?? []) {
    const ben = cob.beneficiario as unknown as {
      id: string;
      nome: string;
      cpf: string;
      telefone: string | null;
      perfil: string;
      status_totalpass: string;
      gateway_pagamento?: string | null;
    };

    if (!ben || ben.perfil !== "titular") {
      summary.skipped++;
      continue;
    }

    // Trilho Asaas apenas — Infinity tem cron próprio (fase 4)
    const gateway = ben.gateway_pagamento ?? "asaas";
    if (gateway !== "asaas") {
      summary.skipped++;
      continue;
    }

    // Já concluído no Manager (manual ou auto anterior)
    if (await isBeneficiarioDesvinculoConcluido(supabase, ben.id)) {
      await cancelBridgeJobsForBeneficiario(
        supabase,
        ben.id,
        "ja_desvinculado"
      );
      summary.skipped++;
      continue;
    }

    const statusOk = ["ativo", "elegivel"].includes(ben.status_totalpass);
    if (!statusOk) {
      if (ben.status_totalpass !== "inativo") {
        summary.skipped++;
        continue;
      }
      const { data: assinaturaAtiva } = await supabase
        .from("assinaturas")
        .select("id")
        .eq("beneficiario_id", ben.id)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (!assinaturaAtiva) {
        summary.skipped++;
        continue;
      }
    }

    try {
      const { data: aviso } = await supabase
        .from("desvinculo_avisos")
        .select("*")
        .eq("beneficiario_id", ben.id)
        .eq("cobranca_id", cob.id)
        .maybeSingle();

      if (!aviso) {
        const dataLimite = addDaysIso(today, bridge.dias_aviso_final);
        const dataLimiteLabel = formatDataLimiteComHora(dataLimite);
        const temPlanoAtivo = ["ativo"].includes(ben.status_totalpass);

        const mensagemPlano = temPlanoAtivo
          ? `Caso tenha plano ativo, você só conseguirá utilizar até o final do ciclo (data limite ${dataLimiteLabel}).`
          : "Caso não tenha plano ativo, não conseguirá contratar pela empresa após o desvinculo.";

        const paymentVars = await buildPaymentTemplateVars(
          supabase,
          cob.asaas_payment_id,
          {
            nome: ben.nome,
            valor: Number(cob.valor).toFixed(2).replace(".", ","),
            data_vencimento: formatBrDate(String(cob.vencimento).slice(0, 10)),
          }
        );

        if (dryRun) {
          await createLog(supabase, {
            acao: "bridge_dry_run_aviso",
            entidade: "cobrancas",
            entidade_id: cob.id,
            payload: {
              beneficiario_id: ben.id,
              data_limite: dataLimite,
              bridge_online: bridgeOnline,
            },
          });
          summary.avisados++;
          continue;
        }

        await supabase.from("desvinculo_avisos").insert({
          beneficiario_id: ben.id,
          cobranca_id: cob.id,
          data_limite: dataLimite,
        });

        await scheduleMessage(supabase, {
          evento: "aviso_desvinculo_totalpass",
          beneficiarioId: ben.id,
          vars: {
            ...paymentVars,
            data_limite: dataLimiteLabel,
            tem_plano_ativo: temPlanoAtivo ? "sim" : "nao",
            mensagem_plano: mensagemPlano,
            link_pagamento: paymentVars.link_fatura || "",
            instrucao_pagamento: paymentVars.link_fatura
              ? "Toque no botão abaixo para regularizar o pagamento."
              : "Entre em contato conosco para regularizar o pagamento.",
          },
          asaasPaymentId: cob.asaas_payment_id,
          refId: `desvinculo:${cob.id}`,
        });

        summary.avisados++;
        continue;
      }

      if (aviso.data_limite > today) {
        summary.skipped++;
        continue;
      }

      // Prazo vencido — se bridge offline, fica para manual (ou até voltar)
      if (!bridgeOnline) {
        summary.aguardandoManual++;
        continue;
      }

      if (remainingDailyCap <= 0) {
        summary.aguardandoManual++;
        continue;
      }

      if (dryRun) {
        await createLog(supabase, {
          acao: "bridge_dry_run_enqueue",
          entidade: "cobrancas",
          entidade_id: cob.id,
          payload: { beneficiario_id: ben.id },
        });
        summary.enfileirados++;
        remainingDailyCap--;
        continue;
      }

      // Re-checa antes de enfileirar (pode ter sido manual entre o scan e agora)
      if (await isBeneficiarioDesvinculoConcluido(supabase, ben.id)) {
        await cancelBridgeJobsForBeneficiario(
          supabase,
          ben.id,
          "ja_desvinculado"
        );
        summary.skipped++;
        continue;
      }

      const enq = await enqueueBridgeJob(supabase, {
        beneficiarioId: ben.id,
        cpf: ben.cpf,
        cobrancaId: cob.id,
        dataLimite: aviso.data_limite,
      });

      if (enq.created) {
        summary.enfileirados++;
        remainingDailyCap--;
        await createLog(supabase, {
          acao: "bridge_job_enqueued",
          entidade: "bridge_jobs",
          entidade_id: enq.jobId,
          payload: { beneficiario_id: ben.id, cobranca_id: cob.id },
        });
      } else {
        summary.skipped++;
      }
    } catch (e) {
      summary.errors.push(
        `${cob.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (!dryRun && summary.avisados > 0) {
    try {
      await drainMessageQueue(supabase);
    } catch {
      // cron de mensagens processa depois
    }
  }

  return summary;
}
