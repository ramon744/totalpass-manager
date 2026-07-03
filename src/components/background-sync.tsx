"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Dispara a sincronização com o Asaas em segundo plano, sem bloquear a página.
 * A tela carrega instantaneamente com os dados do banco; quando o sync termina
 * e algo mudou, atualiza a tela uma única vez.
 *
 * Roda só uma vez por carregamento (o ref sobrevive ao router.refresh, evitando
 * loop). Não altera layout nem design.
 */
export function BackgroundSync({ tipo }: { tipo: "subscriptions" | "cobrancas" }) {
  const router = useRouter();
  const jaRodou = useRef(false);

  useEffect(() => {
    if (jaRodou.current) return;
    jaRodou.current = true;

    let cancelado = false;

    fetch(`/api/sync?tipo=${tipo}`, { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then(() => {
        if (!cancelado) router.refresh();
      })
      .catch(() => {
        // Falha de sync não impacta a navegação; dados do banco já estão na tela.
      });

    return () => {
      cancelado = true;
    };
  }, [tipo, router]);

  return null;
}
