import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/* POST /api/wa/blast
   Body: { commodity: "Wortel", qty: 200, unit: "kg" }
   1. Find (or create) the commodity
   2. Create a demand + demand_item for the first SPPG
   3. farmers_to_notify() → send Fonnte WA to each (capped by BLAST_MAX_RECIPIENTS)
   Returns: { demandItemId, notified }                                          */
export async function POST(req: NextRequest) {
  const { commodity, qty, unit = "kg" } = await req.json();
  if (!commodity || !qty || qty <= 0)
    return NextResponse.json({ error: "commodity dan qty wajib diisi" }, { status: 400 });

  const db = supabaseAdmin();

  let { data: comm } = await db
    .from("commodities").select("id, name")
    .ilike("name", commodity.trim()).maybeSingle();
  if (!comm) {
    const ins = await db
      .from("commodities")
      .insert({ name: commodity.trim().toLowerCase(), unit })
      .select("id, name").single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    comm = ins.data;
  }

  const { data: sppg } = await db.from("sppg").select("id, name").limit(1).single();
  if (!sppg) return NextResponse.json({ error: "Tidak ada SPPG — jalankan seed schema.sql dulu" }, { status: 500 });

  const { data: demand, error: dErr } = await db
    .from("demands")
    .insert({ sppg_id: sppg.id, week_start: nextMonday(), status: "matching" })
    .select("id").single();
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const { data: item, error: iErr } = await db
    .from("demand_items")
    .insert({ demand_id: demand.id, commodity_id: comm.id, qty_kg: qty })
    .select("id").single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const { data: recipients } = await db.rpc("farmers_to_notify", {
    p_demand_item_id: item.id,
    p_radius_km: 30,
  });

  const cap = Number(process.env.BLAST_MAX_RECIPIENTS || 10);
  const targets = (recipients ?? []).slice(0, cap);
  let sent = 0;

  for (const r of targets) {
    const text =
      `${sppg.name} butuh ${qty}${unit} ${comm.name} untuk minggu depan.\n` +
      `Punya stok? Balas: YA [jumlah] [harga per ${unit}]\n` +
      `Contoh: YA 80 9000`;
    try {
      await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: process.env.FONNTE_TOKEN || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: r.wa_number, message: text }),
      });
      sent++;
    } catch { /* keep going — one bad number shouldn't kill the blast */ }
    await db.from("wa_outbound_log").insert({
      farmer_id: r.farmer_id, demand_item_id: item.id, message: text,
    });
    await new Promise((res) => setTimeout(res, 250));
  }

  return NextResponse.json({ demandItemId: item.id, notified: sent, eligible: recipients?.length ?? 0 });
}

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
