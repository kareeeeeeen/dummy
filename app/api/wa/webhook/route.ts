import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { parseFarmerReply } from "@/lib/parser";

/* POST /api/wa/webhook — set this URL in the Fonnte dashboard (device → webhook).
   Fonnte sends { device, sender, message, ... } on every inbound WA.
   Flow: identify farmer → find last demand they were notified about →
   parse with Gemini (regex fallback) → offer goes to `applications`
   (Realtime pushes it to the dashboard), everything is logged to
   `wa_inbound_log` so declines/unclear are visible too.               */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sender = normalizePhone(String(body.sender ?? ""));
  const message = String(body.message ?? "").trim();
  if (!sender || !message) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();

  const { data: farmer } = await db
    .from("farmers").select("id, name").eq("wa_number", sender).maybeSingle();
  if (!farmer) return NextResponse.json({ ok: true }); // unknown number → ignore

  const { data: log } = await db
    .from("wa_outbound_log")
    .select("demand_item_id")
    .eq("farmer_id", farmer.id)
    .order("sent_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!log?.demand_item_id) return NextResponse.json({ ok: true });

  const parsed = await parseFarmerReply(message);

  await db.from("wa_inbound_log").insert({
    farmer_id: farmer.id,
    demand_item_id: log.demand_item_id,
    raw_message: message,
    intent: parsed.intent,
    confidence: parsed.confidence,
  });

  if (parsed.intent === "offer" && parsed.qty && parsed.price_per_unit) {
    await db.from("applications").upsert(
      {
        demand_item_id: log.demand_item_id,
        farmer_id: farmer.id,
        offered_qty_kg: parsed.qty,
        price_per_kg: parsed.price_per_unit,
        raw_message: message,
        parse_confidence: parsed.confidence,
      },
      { onConflict: "demand_item_id,farmer_id" }
    );
    await sendWA(sender,
      `Penawaran dicatat, ${farmer.name.split(" ").slice(0, 2).join(" ")}: ` +
      `${parsed.qty} @ Rp ${parsed.price_per_unit.toLocaleString("id-ID")}. ` +
      `Hasil seleksi dikabari hari ini.`);
  } else if (parsed.intent === "unclear") {
    await sendWA(sender,
      `Maaf, pesannya belum jelas. Balas dengan format: YA [jumlah] [harga]. Contoh: YA 80 9000`);
  }
  // decline & question: logged only; production would route questions to an admin

  return NextResponse.json({ ok: true });
}

async function sendWA(target: string, message: string) {
  try {
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: process.env.FONNTE_TOKEN || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target, message }),
    });
  } catch { /* non-fatal */ }
}

function normalizePhone(p: string): string {
  const digits = p.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return "+62" + digits.slice(1);
  return "+" + digits;
}
