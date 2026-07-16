import { GoogleGenerativeAI } from "@google/generative-ai";

export type ParsedReply = {
  intent: "offer" | "decline" | "question" | "unclear";
  qty: number | null;
  price_per_unit: number | null;
  commodity: string | null;
  confidence: number;
};

const SYSTEM_PROMPT = `Kamu adalah parser untuk platform TaniSPPG. Ubah balasan WhatsApp petani menjadi JSON terstruktur.

Konteks: petani menerima pesan seperti "SPPG Garut butuh 200kg wortel minggu depan. Balas: YA [jumlah] [harga]". Balasan sering berisi typo, singkatan, atau bahasa Sunda.

KELUARKAN HANYA JSON VALID tanpa markdown. Skema:
{"intent":"offer"|"decline"|"question"|"unclear","qty":number|null,"price_per_unit":number|null,"commodity":string|null,"confidence":number}

Aturan:
- "9rb","9 ribu","9000","9k" = 9000
- "1,5 kuintal"/"kwintal" = 150 kg. "1 ton" = 1000. "50 kilo" = 50.
- Harga < 100 tanpa satuan → asumsikan ribuan, confidence maks 0.6
- Total harga bukan per satuan (contoh "80kg 720rb") → hitung per satuan, confidence maks 0.7
- "gak ada","kosong","belum panen","teu aya","teu tiasa" → decline
- Pertanyaan ("kapan diambil?","bayarnya gimana?") → question
- Offer tanpa qty ATAU harga yang jelas → unclear, confidence rendah
- JANGAN menebak angka yang tidak ada di pesan.

Contoh:
"YA 80 9000" → {"intent":"offer","qty":80,"price_per_unit":9000,"commodity":null,"confidence":0.98}
"punya 80kg pak harga 9rb" → {"intent":"offer","qty":80,"price_per_unit":9000,"commodity":null,"confidence":0.95}
"ada wortel 1,5 kwintal, 8500 aja pak" → {"intent":"offer","qty":150,"price_per_unit":8500,"commodity":"wortel","confidence":0.92}
"bs 50 kilo tp minggu dpn ya, 10rb" → {"intent":"offer","qty":50,"price_per_unit":10000,"commodity":null,"confidence":0.85}
"punten teu aya stok ayeuna" → {"intent":"decline","qty":null,"price_per_unit":null,"commodity":null,"confidence":0.9}
"ini diambil kapan pak?" → {"intent":"question","qty":null,"price_per_unit":null,"commodity":null,"confidence":0.95}
"ada sih lumayan" → {"intent":"unclear","qty":null,"price_per_unit":null,"commodity":null,"confidence":0.3}`;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export async function parseFarmerReply(message: string): Promise<ParsedReply> {
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      });
      const result = await model.generateContent(message);
      const parsed = JSON.parse(result.response.text());
      if (isValid(parsed)) return parsed;
    } catch {
      /* fall through to regex — never let a demo die on an API hiccup */
    }
  }
  return regexFallback(message);
}

function isValid(p: any): p is ParsedReply {
  return (
    p &&
    ["offer", "decline", "question", "unclear"].includes(p.intent) &&
    typeof p.confidence === "number"
  );
}

/* Happy-path safety net: "YA 80 9000", "80kg 9rb", "punya 80 kg harga 9000" */
function regexFallback(msg: string): ParsedReply {
  const m = msg.toLowerCase().replace(/,/g, ".");
  if (/\b(gak ada|ga ada|kosong|belum panen|teu aya|teu tiasa|tidak)\b/.test(m))
    return { intent: "decline", qty: null, price_per_unit: null, commodity: null, confidence: 0.7 };
  if (/\?\s*$/.test(m) || /\b(kapan|gimana|bagaimana|dimana)\b/.test(m))
    return { intent: "question", qty: null, price_per_unit: null, commodity: null, confidence: 0.6 };

  const qty = m.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo|ikat|buah)?\b/);
  const price = m.match(/(\d+(?:\.\d+)?)\s*(?:rb|ribu|k\b|000)/);
  if (qty && price) {
    let p = parseFloat(price[1]);
    if (/rb|ribu|k\b/.test(price[0])) p *= 1000;
    return { intent: "offer", qty: parseFloat(qty[1]), price_per_unit: p, commodity: null, confidence: 0.5 };
  }
  return { intent: "unclear", qty: null, price_per_unit: null, commodity: null, confidence: 0.2 };
}
