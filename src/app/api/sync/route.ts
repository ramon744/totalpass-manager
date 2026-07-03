import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { syncSubscriptionsFromAsaas, reconcileTitularesComDependentesCobrando } from "@/lib/services/subscriptions";
import { syncCobrancasFromAsaas, reconcileCobrancasAssinaturaCancelada } from "@/lib/services/cobrancas";

/**
 * Sincronização sob demanda com o Asaas, chamada em segundo plano pelas telas.
 * Mantém a navegação rápida: a página renderiza com dados do banco e este
 * endpoint atualiza o banco depois, sem bloquear o carregamento.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const tipo = request.nextUrl.searchParams.get("tipo") ?? "subscriptions";
  const client = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    if (tipo === "cobrancas") {
      await reconcileCobrancasAssinaturaCancelada(client);
      await syncCobrancasFromAsaas(client);
    } else {
      await syncSubscriptionsFromAsaas(client);
      await reconcileCobrancasAssinaturaCancelada(client);
      await reconcileTitularesComDependentesCobrando(client, {
        userId: user.id,
        notificar: false,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao sincronizar" },
      { status: 500 }
    );
  }
}
