import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processOverdueInactivations } from "@/lib/services/overdue-inactivation";
import { processInfinityOverdueInactivations } from "@/lib/services/infinity-overdue-inactivation";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const asaas = await processOverdueInactivations(supabase);
  const infinity = await processInfinityOverdueInactivations(supabase);
  return NextResponse.json({ asaas, infinity });
}
