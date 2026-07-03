import { NextRequest, NextResponse } from "next/server";
import { getAsaasConfig } from "@/lib/config";
import { createServiceClient } from "@/lib/supabase/server";
import { handleAsaasWebhook } from "@/lib/services/dashboard";

export async function POST(request: NextRequest) {
  const token = request.headers.get("asaas-access-token");
  const supabase = await createServiceClient();
  const asaasConfig = await getAsaasConfig(supabase);
  const expectedToken =
    process.env.ASAAS_WEBHOOK_TOKEN || asaasConfig?.webhook_token;

  if (
    expectedToken &&
    token !== expectedToken
  ) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const body = await request.json();
  const event = body.event as string;
  const payment = body.payment;
  const subscription = body.subscription;

  try {
    await handleAsaasWebhook(supabase, event, payment, subscription);
    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 500 }
    );
  }
}
