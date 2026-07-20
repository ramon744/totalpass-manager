import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendBridgeOfflineAdminAlert } from "@/lib/services/bridge-jobs";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const result = await sendBridgeOfflineAdminAlert(supabase);
  return NextResponse.json(result);
}
