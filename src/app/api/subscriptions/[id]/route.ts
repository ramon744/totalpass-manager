import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  cancelSubscription,
  reactivateSubscription,
  updateSubscription,
} from "@/lib/services/subscriptions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await createServiceClient()
    : supabase;

  try {
    if (body.action === "cancel") {
      await cancelSubscription(serviceClient, id, user.id);
    } else if (body.action === "reactivate") {
      await reactivateSubscription(serviceClient, id, user.id);
    } else if (body.action === "update") {
      await updateSubscription(
        serviceClient,
        id,
        { valor: body.valor, nextDueDate: body.nextDueDate },
        user.id
      );
    } else {
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 }
    );
  }
}
