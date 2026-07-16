/* ======================================================================
   SIMULATION ENGINE — deterministic fake data for sim mode + demo fallback.
   v2 changes vs the original prototype:
   - Roster expanded 12 → 96 farmers (matches the "80+ petani" landing claim)
   - Replies now have a kind: 'offer' | 'decline' | 'unclear'
     (shows the AI parser handling messy input, not just happy paths)
   - staggerDelay(): first ~8 replies arrive slowly (visible drama),
     the rest accelerate so 90 farmers finish in ~9s, not 50s
====================================================================== */

export function strToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMED = [
  { id: "f1",  name: "Pak Ujang",   desa: "Cikajang",       distanceKm: 6,  angle: 35,  reliability: 95 },
  { id: "f2",  name: "Bu Iyan",     desa: "Cisurupan",      distanceKm: 9,  angle: 80,  reliability: 88 },
  { id: "f3",  name: "Pak Dedi",    desa: "Samarang",       distanceKm: 4,  angle: 150, reliability: 78 },
  { id: "f4",  name: "Bu Euis",     desa: "Pasirwangi",     distanceKm: 14, angle: 200, reliability: 96 },
  { id: "f5",  name: "Pak Asep",    desa: "Bayongbong",     distanceKm: 11, angle: 260, reliability: 65 },
  { id: "f6",  name: "Bu Nani",     desa: "Cilawu",         distanceKm: 18, angle: 300, reliability: 90 },
  { id: "f7",  name: "Pak Yayat",   desa: "Leles",          distanceKm: 22, angle: 20,  reliability: 55 },
  { id: "f8",  name: "Bu Rina",     desa: "Tarogong Kaler", distanceKm: 3,  angle: 190, reliability: 99 },
  { id: "f9",  name: "Pak Wawan",   desa: "Karangpawitan",  distanceKm: 8,  angle: 110, reliability: 70 },
  { id: "f10", name: "Bu Siti",     desa: "Banyuresmi",     distanceKm: 16, angle: 240, reliability: 84 },
  { id: "f11", name: "Pak Endang",  desa: "Cisompet",       distanceKm: 27, angle: 330, reliability: 60 },
  { id: "f12", name: "Bu Lilis",    desa: "Pameungpeuk",    distanceKm: 25, angle: 60,  reliability: 91 },
];

const FIRST = ["Asep","Ujang","Dedi","Cecep","Yayat","Endang","Tatang","Iis","Nenden","Euis","Wawan","Rina","Siti","Lilis","Nani","Iyan","Odih","Maman"];
const LAST  = ["Suryana","Hidayat","Permana","Ruhiyat","Kusnadi","Saputra","Mulyana","Rahmat","Sutisna","Gunawan"];
const DESA  = ["Cikajang","Cisurupan","Samarang","Pasirwangi","Bayongbong","Cilawu","Leles","Tarogong Kaler","Karangpawitan","Banyuresmi","Cisompet","Pameungpeuk","Wanaraja","Sukaresmi"];

export const ROSTER_SIZE = 96;

export const FARMER_PROFILES = (() => {
  const roster = [...NAMED];
  for (let i = roster.length; i < ROSTER_SIZE; i++) {
    const rnd = mulberry32(strToSeed("farmer::" + i));
    const title = rnd() < 0.5 ? "Pak" : "Bu";
    roster.push({
      id: "g" + i,
      name: `${title} ${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)][0]}.`,
      desa: DESA[Math.floor(rnd() * DESA.length)],
      distanceKm: Math.round(2 + rnd() * 27),
      angle: Math.round(rnd() * 360),
      reliability: Math.round(55 + rnd() * 44),
    });
  }
  return roster;
})();

export function fmtRp(n) { return "Rp " + Math.round(n).toLocaleString("id-ID"); }

const OFFER_TEMPLATES = [
  (n, q, u, h) => `ada ${n} ${q}${u} pak, harga ${h}/${u} ya`,
  (n, q, u, h) => `punya ${n} ${q}${u}, ${h} aja`,
  (n, q, u, h) => `${n} ${q}${u} tersedia bu, ${h}/${u}`,
  (n, q, u, h) => `kalo ${n} ada ${q}${u}, harga ${h}`,
  (n, q, u, h) => `stok ${n} ${q}${u} pak, ${h}/${u}`,
  (n, q, u, h) => `ready ${n} ${q}${u}, minat ${h}/${u} ga`,
];
const DECLINE_TEMPLATES = [
  () => `teu aya stok ayeuna pak, punten`,
  () => `kosong bu, belum panen`,
  () => `maaf lg ga ada, coba minggu depan`,
  () => `minggu ieu teu tiasa pak, panen bulan hareup`,
];
const UNCLEAR_TEMPLATES = [
  () => `ada sih lumayan`,
  () => `bisa kayanya, brp ya pak`,
  () => `ntar sy cek dulu di kebon`,
];

/* Every farmer rolls one of: offer 55% / decline 14% / unclear 7% / silent 24%.
   Seeded per (ingredient, farmer) so the same ingredient always yields the
   same set of replies — a stable, rehearsable demo. */
export function getRepliesFor(ingredient) {
  return FARMER_PROFILES.map((f) => {
    const rnd = mulberry32(strToSeed(ingredient.id + "::" + f.id));
    const roll = rnd();
    if (roll >= 0.76) return null; // silent
    if (roll >= 0.62) {
      const tpl = roll >= 0.69 ? UNCLEAR_TEMPLATES : DECLINE_TEMPLATES;
      const kind = roll >= 0.69 ? "unclear" : "decline";
      return { kind, farmer: f, qty: null, harga: null, text: tpl[Math.floor(rnd() * tpl.length)]() };
    }
    const qtyRand = rnd(), priceRand = rnd(), tplRand = rnd();
    let qty;
    if (ingredient.unit === "kg") qty = Math.round(20 + qtyRand * 70);
    else if (ingredient.unit === "ikat") qty = Math.round(30 + qtyRand * 70);
    else qty = Math.round(15 + qtyRand * 50);
    const harga = Math.max(500, Math.round((ingredient.distributorPrice * (0.6 + priceRand * 0.35)) / 50) * 50);
    const text = OFFER_TEMPLATES[Math.floor(tplRand * OFFER_TEMPLATES.length)](
      ingredient.name.toLowerCase(), qty, ingredient.unit, fmtRp(harga)
    );
    return { kind: "offer", farmer: f, qty, harga, text };
  }).filter(Boolean);
}

export function getOffersFor(ingredient) {
  return getRepliesFor(ingredient).filter((r) => r.kind === "offer");
}

/* First 8 replies land every ~520ms (watchable), then the flood accelerates. */
export function staggerDelay(i) {
  const SLOW = 8, SLOW_MS = 520, FAST_MS = 65;
  return i < SLOW ? 500 + SLOW_MS * i : 500 + SLOW_MS * SLOW + (i - SLOW) * FAST_MS;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function slugify(name) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "bahan";
  return base + "-" + Date.now().toString(36).slice(-4);
}

export const DEFAULT_INGREDIENTS = [
  { id: "wortel", name: "Wortel",      unit: "kg",   demand: 200, distributorPrice: 12000, distributorDays: 3, tag: "Umbi" },
  { id: "tomat",  name: "Tomat",       unit: "kg",   demand: 80,  distributorPrice: 15000, distributorDays: 3, tag: "Sayur" },
  { id: "cabai",  name: "Cabai Merah", unit: "kg",   demand: 40,  distributorPrice: 42000, distributorDays: 3, tag: "Bumbu" },
  { id: "bayam",  name: "Bayam",       unit: "ikat", demand: 150, distributorPrice: 3800,  distributorDays: 2, tag: "Sayur" },
];

export const UNITS = ["kg", "ikat", "buah", "liter"];

export const LOGISTICS = {
  aggregator: "Gapoktan Mekar Tani",
  schedule: "Kamis, 06.00 WIB",
  meetingPoint: "Balai Desa Cilawu",
};
