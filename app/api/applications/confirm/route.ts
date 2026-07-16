import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const LOGISTICS = {
  aggregator: "Gapoktan Mekar Tani",
  schedule: "Kamis pagi (06.00 WIB)",
  meetingPoint: "Balai Desa Cilawu",
};

/* POST /api/applications/confirm
   Body: { applicationId: uuid }
   Marks the application accepted, records the match, and sends the
   farmer their confirmation WA with pickup logistics.               */
export async function POST(req: NextRequest) {
  const { applicationId } = await req.json();
  if (!applicationId)
    return NextResponse.json({ error: "applicationId wajib" }, { status: 400 });

  const db = supabaseAdmin();

  const { data: app, error } = await db
    .from("applications")
    .update({ status: "accepted" })
    .eq("id", applicationId)
    .select("id, offered_qty_kg, price_per_kg, farmer_id, farmers(name, wa_number)")
    .single();
  if (error || !app)
    return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  await db.from("matches").upsert(
    { application_id: app.id },
    { onConflict: "application_id" }
  );

  const farmer: any = app.farmers;
  const total = app.offered_qty_kg * app.price_per_kg;
  if (farmer?.wa_number) {
    try {
      await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: process.env.FONNTE_TOKEN || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: farmer.wa_number,
          message:
            `Selamat! Penawaran Anda DITERIMA.\n` +
            `${app.offered_qty_kg} @ Rp ${app.price_per_kg.toLocaleString("id-ID")} = Rp ${total.toLocaleString("id-ID")}\n` +
            `Penjemputan: ${LOGISTICS.schedule} oleh ${LOGISTICS.aggregator}, titik kumpul ${LOGISTICS.meetingPoint}.`,
        }),
      });
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, applicationId: app.id });
}
