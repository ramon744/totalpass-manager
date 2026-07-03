"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Componente invisível que escuta mudanças no banco (Supabase Realtime)
 * e atualiza a tela automaticamente. Não altera layout nem design.
 *
 * Uso: <RealtimeRefresher tables={["beneficiarios", "cobrancas"]} />
 */
export function RealtimeRefresher({ tables }: { tables: string[] }) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tablesKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Debounce maior evita refresh em cascata quando syncs atualizam várias linhas.
      timeoutRef.current = setTimeout(() => {
        router.refresh();
      }, 1500);
    };

    const channel = supabase.channel(`realtime:${tablesKey}`);

    for (const table of tablesKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh
      );
    }

    channel.subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [router, tablesKey]);

  return null;
}
