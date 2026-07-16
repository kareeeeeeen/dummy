"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sprout, MapPin, Send, Sparkles, CheckCircle2, ArrowLeft, MessageCircle,
  Radio, RotateCcw, Users, Wheat, Plus, Trash2, Pencil, Truck, XCircle,
  HelpCircle, Zap, FlaskConical, AlertTriangle,
} from "lucide-react";
import {
  FARMER_PROFILES, DEFAULT_INGREDIENTS, UNITS, LOGISTICS,
  getRepliesFor, staggerDelay, shuffle, slugify, fmtRp, strToSeed,
} from "@/lib/sim";
import { supabaseBrowser } from "@/lib/supabase";

/* ======================================================================
   DASHBOARD v2 — fixes & features vs the original prototype:
   [FIX] Timers are per-ingredient (timersRef.current[id]) — broadcasting
         tomat no longer kills wortel's incoming replies.
   [FIX] Editing distributor price/unit AFTER replies arrived resets that
         ingredient (stale offers can't contradict the map/ranking).
   [FIX] demand clamped to >= 1 (no Infinity progress bar).
   [NEW] Replies have kinds: offer / decline / unclear — the ticker shows
         AI filtering messy input, not just happy paths.
   [NEW] Logistics card (Gapoktan pickup) appears once demand is covered.
   [NEW] mode: 'sim' | 'live'. Live wires to /api/wa/blast, Supabase
         Realtime on `applications` + `wa_inbound_log`, ranked_applications
         view, and /api/applications/confirm. Sim is the demo-day fallback.
====================================================================== */

const MAXKM = 30, R = 160, CX = 200, CY = 200;
const angleFor = (f) => f.angle ?? Math.abs(strToSeed(String(f.id))) % 360;
const pos = (f) => {
  const r = Math.min((f.distanceKm ?? MAXKM) / MAXKM, 1) * R;
  const rad = (angleFor(f) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
};

export default function Dashboard() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [ingredients, setIngredients] = useState(DEFAULT_INGREDIENTS);
  const [activeIng, setActiveIng] = useState(DEFAULT_INGREDIENTS[0].id);
  const [mode, setMode] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_MODE === "live" ? "live" : "sim"
  );
  const [status, setStatus] = useState({});      // id -> idle|sending|receiving|done|error
  const [replies, setReplies] = useState({});    // id -> [{kind, farmer, qty, harga, text, key, appId?}]
  const [liveRanked, setLiveRanked] = useState({}); // id -> rows from ranked_applications
  const [confirmedKeys, setConfirmedKeys] = useState({}); // id -> [rowKey]
  const [resetHint, setResetHint] = useState({});
  const [errMsg, setErrMsg] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", unit: "kg", demand: "", distributorPrice: "", tag: "" });

  const timersRef = useRef({});    // [FIX] id -> timeout[]
  const channelsRef = useRef({});  // id -> supabase channel
  const liveItemsRef = useRef({}); // id -> demand_item_id

  const ingredient = ingredients.find((i) => i.id === activeIng) || ingredients[0];

  /* ---------- housekeeping ---------- */
  const clearTimersFor = useCallback((id) => {
    (timersRef.current[id] || []).forEach(clearTimeout);
    timersRef.current[id] = [];
  }, []);
  const closeChannelFor = useCallback((id) => {
    if (channelsRef.current[id] && supabase) supabase.removeChannel(channelsRef.current[id]);
    delete channelsRef.current[id];
  }, [supabase]);
  useEffect(() => () => {
    Object.keys(timersRef.current).forEach(clearTimersFor);
    Object.keys(channelsRef.current).forEach(closeChannelFor);
  }, [clearTimersFor, closeChannelFor]);

  const resetIngredient = useCallback((id, keepHint = false) => {
    clearTimersFor(id);
    closeChannelFor(id);
    setStatus((s) => ({ ...s, [id]: "idle" }));
    setReplies((s) => ({ ...s, [id]: [] }));
    setLiveRanked((s) => ({ ...s, [id]: [] }));
    setConfirmedKeys((s) => ({ ...s, [id]: [] }));
    setErrMsg((s) => ({ ...s, [id]: null }));
    if (!keepHint) setResetHint((s) => ({ ...s, [id]: false }));
  }, [clearTimersFor, closeChannelFor]);

  /* ---------- SIM broadcast ---------- */
  const broadcastSim = useCallback((ing) => {
    const id = ing.id;
    resetIngredient(id);
    setStatus((s) => ({ ...s, [id]: "sending" }));
    const t0 = setTimeout(() => {
      setStatus((s) => ({ ...s, [id]: "receiving" }));
      const order = shuffle(getRepliesFor(ing));
      if (order.length === 0) { setStatus((s) => ({ ...s, [id]: "done" })); return; }
      order.forEach((o, i) => {
        const t = setTimeout(() => {
          setReplies((s) => ({ ...s, [id]: [{ ...o, key: o.farmer.id, ts: Date.now() }, ...(s[id] || [])] }));
          if (i === order.length - 1) {
            const tEnd = setTimeout(() => setStatus((s) => ({ ...s, [id]: "done" })), 400);
            timersRef.current[id].push(tEnd);
          }
        }, staggerDelay(i));
        timersRef.current[id].push(t);
      });
    }, 800);
    timersRef.current[id] = [t0];
  }, [resetIngredient]);

  /* ---------- LIVE broadcast ---------- */
  const refetchLive = useCallback(async (id, itemId) => {
    if (!supabase) return;
    const [{ data: ranked }, { data: inbound }] = await Promise.all([
      supabase.from("ranked_applications").select("*").eq("demand_item_id", itemId),
      supabase.from("wa_inbound_log")
      .select("id, raw_message, intent, offered_qty_kg, price_per_kg, received_at, farmers(name, kecamatan)")
      .eq("demand_item_id", itemId)
      .order("received_at", { ascending: false }),
    ]);
    const rows = (ranked || [])
      .map((r) => ({
        key: r.application_id, appId: r.application_id,
        farmer: {
          id: r.farmer_id, name: r.farmer_name, desa: r.kecamatan || r.gapoktan || "—",
          distanceKm: Math.round(r.distance_km * 10) / 10,
          reliability: Math.round(r.reliability_score * 100),
        },
        qty: r.offered_qty_kg, harga: r.price_per_kg, text: r.raw_message,
        score: r.match_score, dbStatus: r.status,
      }))
      .sort((a, b) => b.score - a.score);
    setLiveRanked((s) => ({ ...s, [id]: rows }));
    setConfirmedKeys((s) => ({
      ...s,
      [id]: rows.filter((r) => r.dbStatus === "accepted").map((r) => r.key),
    }));
    setReplies((s) => ({
      ...s,
      [id]: (inbound || []).map((m) => ({
        kind: m.intent === "offer" ? "offer" : m.intent === "decline" ? "decline" : "unclear",
        farmer: { id: "in" + m.id, name: m.farmers?.name || "Petani", desa: m.farmers?.kecamatan || "" },
        qty: m.offered_qty_kg, harga: m.price_per_kg, text: m.raw_message, key: "in" + m.id,
      })),
    }));

  }, [supabase]);

  const broadcastLive = useCallback(async (ing) => {
    const id = ing.id;
    if (!supabase) {
      setErrMsg((s) => ({ ...s, [id]: "Supabase belum dikonfigurasi (.env.local) — pakai mode Simulasi dulu." }));
      setStatus((s) => ({ ...s, [id]: "error" }));
      return;
    }
    resetIngredient(id);
    setStatus((s) => ({ ...s, [id]: "sending" }));
    try {
      const res = await fetch("/api/wa/blast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commodity: ing.name, qty: ing.demand, unit: ing.unit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Blast gagal");
      liveItemsRef.current[id] = data.demandItemId;
      setStatus((s) => ({ ...s, [id]: "receiving" }));

      const ch = supabase
        .channel("live-" + id)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "applications", filter: `demand_item_id=eq.${data.demandItemId}` },
          () => refetchLive(id, data.demandItemId))
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "wa_inbound_log", filter: `demand_item_id=eq.${data.demandItemId}` },
          () => refetchLive(id, data.demandItemId))
        .subscribe();
      channelsRef.current[id] = ch;
      refetchLive(id, data.demandItemId);
    } catch (e) {
      setErrMsg((s) => ({ ...s, [id]: String(e.message || e) }));
      setStatus((s) => ({ ...s, [id]: "error" }));
    }
  }, [supabase, resetIngredient, refetchLive]);

  const broadcast = mode === "live" ? broadcastLive : broadcastSim;

  /* ---------- ingredient CRUD ---------- */
  const updateIngredient = (id, patch) => {
    const invalidates = ("distributorPrice" in patch || "unit" in patch);
    const hadReplies = (replies[id] || []).length > 0;
    setIngredients((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    if (invalidates && hadReplies) {           // [FIX] stale offers
      resetIngredient(id, true);
      setResetHint((s) => ({ ...s, [id]: true }));
    }
  };
  const removeIngredient = (id) => {
    if (ingredients.length <= 1) return;
    resetIngredient(id);
    const next = ingredients.filter((i) => i.id !== id);
    setIngredients(next);
    if (activeIng === id) setActiveIng(next[0].id);
  };
  const addIngredient = () => {
    const demand = Math.max(1, Number(form.demand) || 0);
    const price = Number(form.distributorPrice);
    if (!form.name.trim() || !Number(form.demand) || !price || price <= 0) return;
    const id = slugify(form.name);
    setIngredients((list) => [...list, {
      id, name: form.name.trim(), unit: form.unit, demand,
      distributorPrice: price, distributorDays: 3, tag: form.tag.trim() || "Custom",
    }]);
    setActiveIng(id);
    setForm({ name: "", unit: "kg", demand: "", distributorPrice: "", tag: "" });
    setShowAdd(false);
  };

  /* ---------- derived rows ---------- */
  const simRanked = useMemo(() => {
    const offers = (replies[ingredient?.id] || []).filter((r) => r.kind === "offer");
    if (!offers.length) return [];
    const maxDist = Math.max(...offers.map((a) => a.farmer.distanceKm));
    const minP = Math.min(...offers.map((a) => a.harga));
    const maxP = Math.max(...offers.map((a) => a.harga));
    return offers.map((a) => ({
      ...a,
      score:
        (1 - a.farmer.distanceKm / (maxDist || 1)) * 0.4 +
        (maxP === minP ? 1 : 1 - (a.harga - minP) / (maxP - minP)) * 0.35 +
        (a.farmer.reliability / 100) * 0.25,
    })).sort((a, b) => b.score - a.score);
  }, [replies, ingredient?.id]);

  const ranked = mode === "live" ? (liveRanked[ingredient?.id] || []) : simRanked;
  const tickerItems = replies[ingredient?.id] || [];
  const confirmedList = confirmedKeys[ingredient?.id] || [];
  const confirmedRows = ranked.filter((r) => confirmedList.includes(r.key));
  const totalQty = confirmedRows.reduce((s, r) => s + r.qty, 0);
  const demandSafe = Math.max(1, ingredient?.demand || 1);   // [FIX] no /0
  const progressPct = Math.min(100, (totalQty / demandSafe) * 100);
  const localCost = confirmedRows.reduce((s, r) => s + r.qty * r.harga, 0);
  const avgLocal = totalQty ? localCost / totalQty : 0;
  const savingsPct = totalQty && ingredient
    ? ((ingredient.distributorPrice - avgLocal) / ingredient.distributorPrice) * 100 : 0;
  const demandMet = totalQty >= demandSafe;

  const toggleConfirm = async (row) => {
    const id = ingredient.id;
    const already = confirmedList.includes(row.key);
    if (mode === "live") {
      if (already) return; // live confirmations are final (WA already sent)
      const res = await fetch("/api/applications/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: row.appId }),
      });
      if (res.ok) setConfirmedKeys((s) => ({ ...s, [id]: [...(s[id] || []), row.key] }));
      return;
    }
    setConfirmedKeys((s) => ({
      ...s,
      [id]: already ? (s[id] || []).filter((k) => k !== row.key) : [...(s[id] || []), row.key],
    }));
  };

  const aggregate = useMemo(() => {
    let retained = 0, savingsSum = 0, countDone = 0;
    ingredients.forEach((ing) => {
      const rows = (mode === "live" ? (liveRanked[ing.id] || []) : [])
        .concat(mode === "sim" ? (replies[ing.id] || []).filter((r) => r.kind === "offer") : []);
      const confirmed = rows.filter((r) => (confirmedKeys[ing.id] || []).includes(r.key));
      const qty = confirmed.reduce((s, r) => s + r.qty, 0);
      if (!qty) return;
      const cost = confirmed.reduce((s, r) => s + r.qty * r.harga, 0);
      retained += cost;
      savingsSum += ((ing.distributorPrice - cost / qty) / ing.distributorPrice) * 100;
      countDone += 1;
    });
    return { retained, avgSavings: countDone ? savingsSum / countDone : 0, countDone };
  }, [ingredients, replies, liveRanked, confirmedKeys, mode]);

  if (!ingredient) return null;
  const st = status[ingredient.id] || "idle";
  const offerCount = tickerItems.filter((t) => t.kind === "offer").length;
  const repliedFarmerIds = new Set(tickerItems.filter((t) => t.kind === "offer").map((t) => t.farmer.id));
  const confirmedFarmerIds = new Set(confirmedRows.map((r) => r.farmer.id));

  return (
    <div style={{ padding: 22 }}>
      <style>{`
        .dash-topbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:18px; flex-wrap:wrap; }
        .back-btn { display:flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--line); border-radius:999px; padding:8px 14px; font-size:12.5px; font-weight:700; color:var(--sawah-deep); cursor:pointer; font-family:inherit; }
        .mode-toggle { display:flex; border:1.5px solid var(--line); border-radius:999px; overflow:hidden; background:var(--card); }
        .mode-btn { border:none; background:transparent; padding:8px 14px; font-size:12px; font-weight:700; color:var(--ink-soft); cursor:pointer; display:flex; align-items:center; gap:5px; font-family:inherit; }
        .mode-btn.on { background:var(--sawah); color:#F4EFD9; }
        .tsppg-header { display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:16px; border-bottom:2px solid var(--sawah); padding-bottom:18px; margin-bottom:20px; }
        .brand { display:flex; gap:12px; align-items:center; }
        .brand-icon { width:46px; height:46px; border-radius:10px; background:var(--sawah); color:var(--gold); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .brand h1 { font-size:24px; font-weight:700; margin:0; letter-spacing:-0.01em; color:var(--sawah-deep); }
        .brand p { margin:2px 0 0; font-size:12.5px; color:var(--ink-soft); }
        .header-stats { display:flex; gap:10px; flex-wrap:wrap; }
        .mini-stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:8px 14px; min-width:118px; }
        .mini-stat .label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); }
        .mini-stat .value { font-family:var(--font-spacemono),monospace; font-weight:700; font-size:15px; color:var(--sawah-deep); }
        .ing-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center; }
        .ing-tab { border:1.5px solid var(--line); background:var(--card); border-radius:999px; padding:8px 16px; font-size:13px; font-weight:600; color:var(--ink-soft); cursor:pointer; display:flex; align-items:center; gap:8px; font-family:inherit; }
        .ing-tab.active { background:var(--sawah); color:#F4EFD9; border-color:var(--sawah); }
        .ing-tab .dot { width:8px; height:8px; border-radius:50%; background:#B7AD7D; }
        .ing-tab .dot.done { background:var(--green-ok); }
        .ing-tab .dot.prog { background:var(--gold); animation:pulse 1.1s infinite; }
        .ing-tab-add { border:1.5px dashed var(--sawah); background:transparent; color:var(--sawah); border-radius:999px; padding:8px 14px; font-size:13px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; font-family:inherit; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
        .add-form { background:var(--card); border:1.5px dashed var(--line); border-radius:14px; padding:16px; margin-bottom:18px; display:grid; grid-template-columns:1.4fr .8fr .9fr .9fr .9fr auto; gap:10px; align-items:end; }
        @media (max-width:860px){ .add-form { grid-template-columns:1fr 1fr; } }
        .tsppg-grid { display:grid; grid-template-columns:1.15fr .85fr; gap:20px; }
        @media (max-width:860px){ .tsppg-grid { grid-template-columns:1fr; } }
        .panel { display:flex; flex-direction:column; gap:16px; }
        .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
        .card h2 { font-size:15px; font-weight:600; margin:0 0 4px; color:var(--sawah-deep); display:flex; align-items:center; gap:8px; }
        .card .sub { font-size:12px; color:var(--ink-soft); margin:0 0 14px; }
        .demand-headline { display:flex; align-items:baseline; gap:10px; }
        .demand-headline input.num { font-size:44px; font-weight:800; color:var(--sawah-deep); line-height:1; width:130px; }
        .demand-headline .unit { font-size:15px; color:var(--ink-soft); font-weight:600; }
        .demand-compare { display:flex; align-items:center; gap:10px; margin-top:12px; font-size:12px; color:var(--ink-soft); flex-wrap:wrap; }
        .demand-compare input.mono { width:90px; color:var(--clay); font-weight:700; font-family:var(--font-spacemono),monospace; }
        .row-actions { display:flex; gap:10px; align-items:center; margin-top:14px; flex-wrap:wrap; }
        .status-badge { font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; display:inline-flex; align-items:center; gap:6px; }
        .status-sending { background:#EFE0B8; color:#7A5A0E; }
        .status-receiving { background:#DCEAD9; color:#2F5D37; }
        .status-done { background:#CFE3D0; color:var(--green-ok); }
        .status-error { background:#F3D5C8; color:var(--clay); }
        .hint { font-size:11.5px; color:var(--clay); display:flex; align-items:center; gap:5px; margin-top:8px; }
        .ticker-list { display:flex; flex-direction:column; gap:8px; max-height:250px; overflow-y:auto; padding-right:4px; }
        .ticker-item { border:1px solid var(--line); border-radius:10px; padding:9px 12px; background:#FEFDF6; animation:slideIn .35s ease; }
        .ticker-item.decline { background:#F3F0E2; opacity:.8; }
        .ticker-item.unclear { background:#FBF3DC; }
        @keyframes slideIn { from { opacity:0; transform:translateY(-8px);} to { opacity:1; transform:translateY(0);} }
        .ticker-item .row1 { display:flex; justify-content:space-between; font-size:12.5px; font-weight:700; color:var(--sawah-deep); }
        .ticker-item .raw { font-size:12px; color:var(--ink-soft); font-style:italic; margin:3px 0 6px; }
        .ticker-item .parsed { display:flex; gap:8px; align-items:center; font-size:11px; flex-wrap:wrap; }
        .parsed .pill { background:var(--sawah); color:#EFE9C9; border-radius:6px; padding:2px 8px; font-family:var(--font-spacemono),monospace; font-weight:700; }
        .parsed .tag-ai { color:var(--gold-deep); display:flex; align-items:center; gap:3px; font-weight:700; }
        .parsed .tag-decline { color:var(--ink-soft); display:flex; align-items:center; gap:3px; font-weight:700; }
        .parsed .tag-unclear { color:#9A6E0C; display:flex; align-items:center; gap:3px; font-weight:700; }
        .empty-hint { font-size:12.5px; color:var(--ink-soft); padding:18px 0; text-align:center; border:1.5px dashed var(--line); border-radius:10px; }
        .progress-track { height:8px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin:6px 0 14px; }
        .progress-fill { height:100%; background:var(--green-ok); transition:width .4s ease; }
        .rank-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--line); }
        .rank-row:first-of-type { border-top:none; }
        .rank-num { font-family:var(--font-spacemono),monospace; font-weight:700; color:var(--ink-soft); width:22px; }
        .rank-main { flex:1; min-width:0; }
        .rank-main .name { font-weight:700; font-size:13.5px; }
        .rank-main .meta { font-size:11.5px; color:var(--ink-soft); display:flex; gap:10px; margin-top:2px; flex-wrap:wrap; }
        .score-bar { width:54px; height:5px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin-top:4px; }
        .score-bar-fill { height:100%; background:var(--gold); }
        .confirm-btn { border:1.5px solid var(--sawah); background:transparent; color:var(--sawah); border-radius:999px; padding:6px 12px; font-size:11.5px; font-weight:700; cursor:pointer; white-space:nowrap; font-family:inherit; }
        .confirm-btn.on { background:var(--green-ok); border-color:var(--green-ok); color:white; }
        .radar-wrap { display:flex; justify-content:center; }
        .radar-legend { display:flex; gap:14px; font-size:11px; color:var(--ink-soft); justify-content:center; margin-top:8px; flex-wrap:wrap; }
        .legend-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:4px; }
        .logistics { border:1.5px solid var(--green-ok); background:#EDF3E8; }
        .logistics h2 { color:var(--green-ok); }
        .logi-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; font-size:12.5px; }
        @media (max-width:640px){ .logi-grid { grid-template-columns:1fr; } }
        .logi-grid .k { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); }
        .logi-grid .v { font-weight:700; color:var(--sawah-deep); margin-top:2px; }
        .logi-note { margin-top:12px; font-size:11.5px; color:var(--green-ok); font-weight:700; display:flex; align-items:center; gap:6px; }
        .summary-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .summary-tile { background:var(--bg-alt); border-radius:10px; padding:12px 14px; }
        .summary-tile .label { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); }
        .summary-tile .value { font-family:var(--font-spacemono),monospace; font-weight:700; font-size:16.5px; color:var(--sawah-deep); margin-top:4px; }
        .summary-tile .value.good { color:var(--green-ok); }
      `}</style>

      <div className="dash-topbar">
        <button className="back-btn" onClick={() => router.push("/")}><ArrowLeft size={14} /> Kembali ke Landing</button>
        <div className="mode-toggle" title="Simulasi = data lokal deterministik. Live = Supabase + WhatsApp + Gemini.">
          <button className={"mode-btn" + (mode === "sim" ? " on" : "")} onClick={() => setMode("sim")}>
            <FlaskConical size={13} /> Simulasi
          </button>
          <button className={"mode-btn" + (mode === "live" ? " on" : "")} onClick={() => setMode("live")}>
            <Zap size={13} /> Live
          </button>
        </div>
      </div>

      <div className="tsppg-header">
        <div className="brand">
          <div className="brand-icon"><Sprout size={22} /></div>
          <div>
            <h1>Dashboard SPPG</h1>
            <p>{mode === "live" ? "Mode LIVE — WhatsApp & database sungguhan" : "Mode simulasi — data deterministik untuk demo"}</p>
          </div>
        </div>
        <div className="header-stats">
          <div className="mini-stat"><div className="label">Bahan terpenuhi</div><div className="value">{aggregate.countDone}/{ingredients.length}</div></div>
          <div className="mini-stat"><div className="label">Rata-rata hemat</div><div className="value">{aggregate.avgSavings ? aggregate.avgSavings.toFixed(0) : 0}%</div></div>
          <div className="mini-stat"><div className="label">Uang tetap di Garut</div><div className="value">{fmtRp(aggregate.retained)}</div></div>
        </div>
      </div>

      <div className="ing-tabs">
        {ingredients.map((ing) => {
          const s = status[ing.id] || "idle";
          return (
            <button key={ing.id} className={"ing-tab" + (ing.id === ingredient.id ? " active" : "")} onClick={() => setActiveIng(ing.id)}>
              <span className={"dot" + (s === "done" ? " done" : s === "sending" || s === "receiving" ? " prog" : "")} />
              {ing.name} · {ing.demand}{ing.unit}
            </button>
          );
        })}
        <button className="ing-tab-add" onClick={() => setShowAdd((v) => !v)}><Plus size={14} /> Tambah bahan</button>
      </div>

      {showAdd && (
        <div className="add-form">
          <div><span className="field-label">Nama bahan</span><input className="field-input" placeholder="mis. Kentang" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div><span className="field-label">Satuan</span>
            <select className="field-input" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div><span className="field-label">Jumlah dibutuhkan</span><input className="field-input" type="number" min="1" placeholder="100" value={form.demand} onChange={(e) => setForm((f) => ({ ...f, demand: e.target.value }))} /></div>
          <div><span className="field-label">Est. harga distributor (Rp)</span><input className="field-input" type="number" min="1" placeholder="10000" value={form.distributorPrice} onChange={(e) => setForm((f) => ({ ...f, distributorPrice: e.target.value }))} /></div>
          <div><span className="field-label">Kategori (opsional)</span><input className="field-input" placeholder="Sayur / Bumbu / Umbi" value={form.tag} onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} /></div>
          <button className="btn btn-primary" style={{ height: 38 }} onClick={addIngredient}><Plus size={15} /> Tambah</button>
        </div>
      )}

      <div className="tsppg-grid">
        <div className="panel">
          <div className="card">
            <h2><Wheat size={16} /> Permintaan minggu ini</h2>
            <p className="sub">SPPG Garut Pusat · <Pencil size={11} style={{ verticalAlign: -1 }} /> jumlah &amp; harga bisa diedit langsung</p>
            <div className="demand-headline">
              <input
                className="plain-input num" type="number" min="1"
                value={ingredient.demand}
                onChange={(e) => updateIngredient(ingredient.id, { demand: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span className="unit">{ingredient.unit} {ingredient.name.toLowerCase()}</span>
            </div>
            <div className="demand-compare">
              Distributor Jakarta:
              <input
                className="plain-input mono" type="number" min="1"
                value={ingredient.distributorPrice}
                onChange={(e) => updateIngredient(ingredient.id, { distributorPrice: Math.max(1, Number(e.target.value) || 1) })}
              />
              /{ingredient.unit}, {ingredient.distributorDays} hari
            </div>
            {resetHint[ingredient.id] && (
              <div className="hint"><AlertTriangle size={13} /> Harga/satuan diubah — balasan lama di-reset, kirim ulang permintaan.</div>
            )}

            <div className="row-actions">
              {(st === "idle" || st === "error") && (
                <button className="btn btn-primary" onClick={() => broadcast(ingredient)}>
                  <Send size={15} /> Kirim permintaan ke petani {mode === "live" ? "(WA sungguhan)" : ""}
                </button>
              )}
              {st === "sending" && <span className="status-badge status-sending"><Radio size={12} /> Mengirim broadcast WhatsApp…</span>}
              {st === "receiving" && (
                <span className="status-badge status-receiving">
                  <MessageCircle size={12} /> Menerima balasan… {tickerItems.length > 0 && `${tickerItems.length} masuk`}
                </span>
              )}
              {st === "done" && (
                <>
                  <span className="status-badge status-done"><CheckCircle2 size={12} /> {tickerItems.length} balasan · {offerCount} penawaran</span>
                  <button className="btn-ghost" onClick={() => resetIngredient(ingredient.id)}><RotateCcw size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Ulangi</button>
                </>
              )}
              {st === "error" && <span className="status-badge status-error"><AlertTriangle size={12} /> {errMsg[ingredient.id]}</span>}
              {(st === "receiving" && mode === "live") && (
                <button className="btn-ghost" onClick={() => resetIngredient(ingredient.id)}><RotateCcw size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Reset</button>
              )}
              {ingredients.length > 1 && (
                <button className="btn-danger" onClick={() => removeIngredient(ingredient.id)}><Trash2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Hapus bahan ini</button>
              )}
            </div>
          </div>

          <div className="card">
            <h2><MessageCircle size={16} /> Papan balasan WhatsApp</h2>
            <p className="sub">Bahasa santai petani → data terstruktur. Balasan kosong &amp; ambigu ikut ditampilkan supaya kelihatan AI-nya menyaring.</p>
            <div className="ticker-list">
              {tickerItems.length === 0 && <div className="empty-hint">Belum ada balasan. Kirim permintaan dulu.</div>}
              {tickerItems.map((t, i) => (
                <div className={"ticker-item " + t.kind} key={t.key + "-" + i}>
                  <div className="row1">
                    <span>{t.farmer.name}{t.farmer.desa ? ` · ${t.farmer.desa}` : ""}</span>
                    {t.farmer.distanceKm != null && <span>{t.farmer.distanceKm} km</span>}
                  </div>
                  <div className="raw">"{t.text}"</div>
                  <div className="parsed">
                    {t.kind === "offer" && (
                      <>
                        <span className="pill">{t.qty}{ingredient.unit}</span>
                        <span className="pill">{fmtRp(t.harga)}/{ingredient.unit}</span>
                        <span className="tag-ai"><Sparkles size={11} /> diproses AI</span>
                      </>
                    )}
                    {t.kind === "decline" && (
                      <span className="tag-decline"><XCircle size={11} /> tidak ada stok — difilter otomatis</span>
                    )}
                    {t.kind === "unclear" && (
                      <span className="tag-unclear"><HelpCircle size={11} /> ambigu — AI minta klarifikasi via WA</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2><Users size={16} /> Rekomendasi petani (terurut AI)</h2>
            <p className="sub">Skor gabungan: jarak 40% · harga 35% · reliabilitas 25%{mode === "live" ? " — dihitung PostGIS di database" : ""}</p>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -8, marginBottom: 6 }}>
              {totalQty}/{ingredient.demand} {ingredient.unit} terkonfirmasi
              {totalQty > 0 && ` · rata-rata ${fmtRp(avgLocal)}/${ingredient.unit} (hemat ${savingsPct.toFixed(0)}%)`}
            </div>
            {ranked.length === 0 && <div className="empty-hint">Daftar akan muncul setelah petani membalas.</div>}
            {ranked.map((r, i) => {
              const isConfirmed = confirmedList.includes(r.key);
              return (
                <div className="rank-row" key={r.key}>
                  <span className="rank-num">#{i + 1}</span>
                  <div className="rank-main">
                    <div className="name">{r.farmer.name} <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>· {r.farmer.desa}</span></div>
                    <div className="meta">
                      <span className="mono">{r.qty}{ingredient.unit}</span>
                      <span className="mono">{fmtRp(r.harga)}/{ingredient.unit}</span>
                      <span><MapPin size={10} style={{ verticalAlign: -1 }} /> {r.farmer.distanceKm}km</span>
                      <span>reliabilitas {r.farmer.reliability}%</span>
                    </div>
                    <div className="score-bar"><div className="score-bar-fill" style={{ width: `${Math.min(100, r.score * 100)}%` }} /></div>
                  </div>
                  <button className={"confirm-btn" + (isConfirmed ? " on" : "")} onClick={() => toggleConfirm(r)}>
                    {isConfirmed ? "✓ Terkonfirmasi" : "Konfirmasi"}
                  </button>
                </div>
              );
            })}
          </div>

          {confirmedRows.length > 0 && (
            <div className="card logistics">
              <h2><Truck size={16} /> Logistik penjemputan {demandMet ? "— kebutuhan terpenuhi" : "— sebagian terkonfirmasi"}</h2>
              <div className="logi-grid">
                <div><div className="k">Agregator</div><div className="v">{LOGISTICS.aggregator}</div></div>
                <div><div className="k">Jadwal jemput</div><div className="v">{LOGISTICS.schedule}</div></div>
                <div><div className="k">Titik kumpul</div><div className="v">{LOGISTICS.meetingPoint}</div></div>
              </div>
              <div className="logi-note">
                <CheckCircle2 size={13} />
                Konfirmasi WhatsApp {mode === "live" ? "terkirim" : "terkirim (simulasi)"} ke {confirmedRows.length} petani · total {fmtRp(localCost)} tetap berputar di Garut
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="card">
            <h2><MapPin size={16} /> Peta radius petani</h2>
            <p className="sub">Jarak dari dapur SPPG (lingkaran = 10 / 20 / 30 km)</p>
            <div className="radar-wrap">
              <svg viewBox="0 0 400 400" width="100%" style={{ maxWidth: 340 }} role="img" aria-label="Peta radius petani di sekitar SPPG">
                {[10, 20, 30].map((km) => <circle key={km} cx={CX} cy={CY} r={(km / MAXKM) * R} fill="none" stroke="#D8CD9C" strokeWidth="1" />)}
                {[10, 20, 30].map((km) => <text key={"t" + km} x={CX + 4} y={CY - (km / MAXKM) * R} fontSize="9" fill="#8C8562" fontFamily="var(--font-spacemono),monospace">{km}km</text>)}
                {(mode === "sim" ? FARMER_PROFILES : ranked.map((r) => r.farmer)).map((f) => {
                  const p = pos(f);
                  const replied = repliedFarmerIds.has(f.id) || mode === "live";
                  const isConf = confirmedFarmerIds.has(f.id);
                  const color = isConf ? "#3D7A4C" : replied ? "#D9A62E" : "#CBBF8E";
                  const rr = isConf ? 7 : replied ? 5.5 : 3.5;
                  return (
                    <g key={f.id}>
                      {isConf && <line x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#3D7A4C" strokeWidth="1" strokeDasharray="4 3" opacity=".6" />}
                      <circle cx={p.x} cy={p.y} r={rr} fill={color} opacity={replied || isConf ? 1 : 0.55} />
                    </g>
                  );
                })}
                <rect x={CX - 11} y={CY - 11} width="22" height="22" rx="6" fill="#B0522C" />
                <text x={CX} y={CY + 4} fontSize="11" fill="#FBF8EC" textAnchor="middle">▲</text>
              </svg>
            </div>
            <div className="radar-legend">
              <span><span className="legend-dot" style={{ background: "#B0522C" }} />Dapur SPPG</span>
              <span><span className="legend-dot" style={{ background: "#CBBF8E" }} />Terdaftar</span>
              <span><span className="legend-dot" style={{ background: "#D9A62E" }} />Menawar</span>
              <span><span className="legend-dot" style={{ background: "#3D7A4C" }} />Terkonfirmasi</span>
            </div>
          </div>

          <div className="card">
            <h2><Sparkles size={16} /> Ringkasan {ingredient.name.toLowerCase()}</h2>
            <div className="summary-grid">
              <div className="summary-tile"><div className="label">Balasan masuk</div><div className="value">{tickerItems.length}</div></div>
              <div className="summary-tile"><div className="label">Penawaran valid</div><div className="value">{offerCount}</div></div>
              <div className="summary-tile"><div className="label">Terkonfirmasi</div><div className="value">{totalQty}{ingredient.unit}</div></div>
              <div className="summary-tile"><div className="label">Hemat vs distributor</div><div className={"value" + (savingsPct > 0 ? " good" : "")}>{savingsPct > 0 ? savingsPct.toFixed(0) + "%" : "—"}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22, textAlign: "center", fontSize: 11.5, color: "var(--ink-soft)" }}>
        TaniSPPG · Garuda Hacks 7.0 · {mode === "live" ? "Terhubung ke Supabase + Fonnte + Gemini" : "Mode simulasi (tanpa backend)"}
      </div>
    </div>
  );
}
