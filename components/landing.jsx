"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sprout, Sparkles, ArrowUpRight, MessageCircle, Wheat, Search, Heart,
  ShoppingBasket, ChevronDown, Smartphone, Route, Handshake, Leaf,
} from "lucide-react";
import { DEFAULT_INGREDIENTS, ROSTER_SIZE, fmtRp } from "@/lib/sim";

/* Landing preserves the team's original visual identity.
   Changes vs prototype:
   - Next.js router navigation instead of view-state prop
   - Accordion chevron no longer hijacks navigation (bug fix)
   - "80+ petani" chip now reads from ROSTER_SIZE so screen == deck   */

function IngredientGlyph({ id }) {
  const shapes = {
    wortel: <svg viewBox="0 0 60 60" width="46"><path d="M30 6 L38 44 L22 44 Z" fill="#D9A62E" /><path d="M30 6 l-6 -8 M30 6 l0 -10 M30 6 l6 -8" stroke="#2f4a34" strokeWidth="3" strokeLinecap="round" /></svg>,
    tomat: <svg viewBox="0 0 60 60" width="46"><circle cx="30" cy="34" r="18" fill="#B0522C" /><path d="M22 20 q8 -10 16 0" stroke="#2f4a34" strokeWidth="3" fill="none" /></svg>,
    cabai: <svg viewBox="0 0 60 60" width="46"><path d="M14 18 Q40 14 44 34 Q46 48 30 46 Q16 44 14 18Z" fill="#B0522C" /><rect x="10" y="12" width="8" height="10" rx="2" fill="#3D7A4C" /></svg>,
    bayam: <svg viewBox="0 0 60 60" width="46"><path d="M30 46 V18" stroke="#2f4a34" strokeWidth="3" /><ellipse cx="30" cy="14" rx="12" ry="9" fill="#3D7A4C" /><ellipse cx="16" cy="24" rx="10" ry="7" fill="#3D7A4C" /><ellipse cx="44" cy="24" rx="10" ry="7" fill="#3D7A4C" /></svg>,
  };
  return shapes[id] ?? <Leaf size={34} color="#2f4a34" strokeWidth={1.6} />;
}

function AccordionList() {
  const steps = [
    { t: "SPPG input menu", d: "Menu minggu depan dimasukkan lewat dashboard — bahan apa saja bisa ditambah, diedit, atau dihapus kapan pun." },
    { t: "Broadcast ke petani", d: "Pesan WhatsApp terkirim ke petani terdaftar di radius sekitar dapur." },
    { t: "AI baca balasan", d: "Balasan bahasa santai (termasuk typo dan bahasa Sunda) diubah jadi data jumlah & harga terstruktur. Balasan 'tidak ada stok' otomatis difilter." },
    { t: "Ranking otomatis", d: "Petani diurutkan berdasarkan jarak, harga, dan riwayat keandalan pengiriman." },
    { t: "Konfirmasi & pickup", d: "SPPG konfirmasi satu tap, koperasi/BUMDes urus pengambilan dan agregasi di titik kumpul desa." },
  ];
  const [open, setOpen] = useState(1);
  return (
    <div>
      {steps.map((s, i) => (
        <div className={"acc-item" + (open === i ? " open" : "")} key={i}>
          <button className="acc-head" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            {s.t}
            <ChevronDown size={15} style={{ transform: open === i ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          <div className="acc-body">{s.d}</div>
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const router = useRouter();
  const goDash = () => router.push("/dashboard");
  const ingredients = DEFAULT_INGREDIENTS;

  return (
    <div style={{ padding: "22px 22px 0" }}>
      <style>{`
        .nav { display:flex; align-items:center; justify-content:space-between; padding-bottom:18px; }
        .nav-logo { display:flex; align-items:center; gap:9px; font-family:var(--font-fraunces),serif; font-weight:700; font-size:19px; color:var(--sawah-deep); }
        .nav-logo .box { width:32px; height:32px; border-radius:8px; background:var(--sawah); color:var(--gold); display:flex; align-items:center; justify-content:center; }
        .nav-links { display:flex; gap:26px; font-size:13.5px; font-weight:600; color:var(--ink-soft); }
        .nav-links a { text-decoration:none; }
        .nav-links a:hover { color: var(--sawah-deep); }
        .nav-icons { display:flex; align-items:center; gap:14px; color: var(--sawah-deep); }
        .nav-cta { background:var(--sawah); color:#F4EFD9; border:none; border-radius:999px; padding:9px 16px; font-weight:700; font-size:12.5px; display:flex; align-items:center; gap:6px; cursor:pointer; font-family:inherit; }
        @media (max-width:820px){ .nav-links{ display:none; } }
        .hero { display:grid; grid-template-columns: 1.35fr 0.95fr 0.7fr; gap:6px; border-radius:20px; overflow:hidden; min-height:460px; }
        @media (max-width:820px){ .hero{ grid-template-columns:1fr; min-height:unset; } }
        .hero-panel { position:relative; overflow:hidden; }
        .hero-main { background: linear-gradient(180deg, #4a6b4e 0%, #2f4a34 55%, #1a2a1e 100%); padding:34px 28px 26px; display:flex; flex-direction:column; justify-content:space-between; color:#F4EFD9; }
        .eyebrow { font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:#CFE3B8; font-weight:700; }
        .hero-main h1 { font-size:35px; line-height:1.12; font-weight:700; margin:10px 0 12px; max-width:420px; }
        .hero-main h1 .accent { color: var(--gold); }
        .hero-main p { font-size:13.5px; color:#DCE6CE; max-width:360px; margin:0 0 18px; }
        .hero-ctas { display:flex; gap:10px; flex-wrap:wrap; }
        .hero-chips { display:flex; gap:10px; flex-wrap:wrap; margin-top:22px; }
        .chip { background:rgba(244,239,217,.12); border:1px solid rgba(244,239,217,.25); border-radius:12px; padding:9px 13px; display:flex; align-items:center; gap:9px; }
        .chip .big { font-family:var(--font-fraunces),serif; font-weight:800; font-size:19px; }
        .chip .small { font-size:10px; color:#CFE3B8; line-height:1.2; }
        .chip .avatars { display:flex; }
        .chip .avatars span { width:20px; height:20px; border-radius:50%; border:1.5px solid #2f4a34; margin-left:-6px; display:inline-block; }
        .hero-chat { background: var(--sawah-deep); padding:20px; display:flex; flex-direction:column; justify-content:center; gap:10px; }
        .wa-bubble { background:#FBF8EC; border-radius:12px 12px 12px 2px; padding:10px 12px; font-size:11.5px; color:var(--ink); max-width:92%; box-shadow:0 3px 0 rgba(0,0,0,.08); }
        .wa-bubble.out { align-self:flex-end; background:var(--gold); border-radius:12px 12px 2px 12px; color:#2A1D06; font-weight:600; }
        .wa-meta { font-size:9px; color:var(--ink-soft); margin-top:3px; text-align:right; }
        .wa-tag { display:flex; align-items:center; gap:6px; color:#CFE3B8; font-size:10.5px; font-weight:700; margin-bottom:4px; }
        .hero-crate { background: repeating-linear-gradient(135deg, #E2D6A0 0 14px, #DACD9C 14px 28px); padding:18px; display:flex; align-items:flex-end; justify-content:center; }
        @media (max-width:820px){ .hero-chat, .hero-crate { min-height:150px; } }
        .hero-foot-strip { display:flex; justify-content:space-between; align-items:center; padding:16px 4px 0; font-size:11px; color:var(--ink-soft); flex-wrap:wrap; gap:10px;}
        .about { padding: 54px 6px 10px; display:grid; grid-template-columns: 0.85fr 1.4fr; gap:30px; }
        @media (max-width:820px){ .about{ grid-template-columns:1fr; } }
        .about-label { font-size:12px; font-weight:700; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.08em; }
        .about h2 { font-size:30px; font-weight:700; color:var(--sawah-deep); margin:8px 0 0; }
        .about h2 u { color: var(--gold-deep); text-decoration-color: var(--gold); }
        .about-copy { display:flex; gap:22px; font-size:13.5px; color:var(--ink-soft); line-height:1.6; margin-top:16px; }
        .about-copy p { margin:0; flex:1; }
        .tile-grid { display:grid; grid-template-columns: 0.85fr 0.7fr 0.95fr 0.85fr; gap:10px; margin-top:20px; }
        @media (max-width:820px){ .tile-grid{ grid-template-columns:1fr 1fr; } }
        .tile { border-radius:14px; padding:14px; min-height:120px; display:flex; flex-direction:column; justify-content:flex-end; }
        .tile-stat { background:var(--card); border:1px solid var(--line); justify-content:flex-start; }
        .tile-stat .n { font-size:26px; font-weight:800; color:var(--sawah-deep); font-family:var(--font-fraunces),serif; }
        .tile-stat .l { font-size:11px; color:var(--ink-soft); margin-top:2px; }
        .tile-illus { background: linear-gradient(160deg,#7a9b6f,#3c5d3f); position:relative; overflow:hidden; }
        .tile-dark { background: var(--sawah); color:#EFE9C9; }
        .tile-dark .n { font-size:24px; font-weight:800; font-family:var(--font-fraunces),serif; }
        .tile-dark .l { font-size:10.5px; color:#CFE3B8; margin-top:2px; }
        .services { padding: 54px 6px 10px; }
        .services-head { display:flex; justify-content:space-between; align-items:center; }
        .services-head h2 { font-size:26px; font-weight:700; color:var(--sawah-deep); display:flex; align-items:center; gap:8px; }
        .btn-pill-outline { background:var(--card); border:1.5px solid var(--sawah); color:var(--sawah); border-radius:999px; padding:9px 16px; font-weight:700; font-size:12.5px; display:flex; align-items:center; gap:6px; cursor:pointer; font-family:inherit; }
        .services-grid { display:grid; grid-template-columns:0.95fr 1.15fr; gap:22px; margin-top:22px; }
        @media (max-width:820px){ .services-grid{ grid-template-columns:1fr; } }
        .services-copy p { font-size:13px; color:var(--ink-soft); line-height:1.65; }
        .flow-illus { margin-top:14px; border-radius:14px; background: linear-gradient(170deg,#3c5d3f,#1c2b1e); min-height:200px; padding:18px; display:flex; flex-direction:column; justify-content:center; gap:8px; }
        .flow-line { display:flex; align-items:center; gap:8px; color:#EFE9C9; font-size:12px; font-weight:700; }
        .acc-item { border-radius:10px; overflow:hidden; margin-bottom:8px; }
        .acc-head { display:flex; align-items:center; justify-content:space-between; width:100%; padding:14px 16px; background:var(--card); border:1px solid var(--line); font-weight:700; font-size:13.5px; cursor:pointer; font-family:inherit; color:inherit; border-radius:0; text-align:left; }
        .acc-item.open .acc-head { background:var(--sawah); color:#EFE9C9; border-color:var(--sawah); }
        .acc-body { background: var(--sawah); color:#DCE6CE; font-size:12.5px; line-height:1.6; padding:0 16px; max-height:0; overflow:hidden; transition:max-height .25s ease, padding .25s ease; }
        .acc-item.open .acc-body { max-height:140px; padding:0 16px 16px; }
        .demandsec { padding: 54px 6px 40px; }
        .demandsec-head { display:flex; justify-content:space-between; align-items:center; }
        .demandsec-head h2 { font-size:26px; font-weight:700; color:var(--sawah-deep); }
        .demand-grid { display:grid; grid-template-columns: repeat(4,1fr); gap:14px; margin-top:22px; }
        @media (max-width:820px){ .demand-grid{ grid-template-columns:1fr 1fr; } }
        .demand-card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; }
        .demand-thumb { height:110px; position:relative; display:flex; align-items:center; justify-content:center; }
        .demand-badge { position:absolute; top:9px; left:9px; background:var(--clay); color:#FBF8EC; font-size:9.5px; font-weight:700; padding:3px 8px; border-radius:6px; }
        .demand-body { padding:12px 14px 14px; }
        .demand-body .name { font-weight:700; font-size:14px; }
        .demand-body .qty { font-size:12px; color:var(--ink-soft); margin-top:2px; }
        .demand-body .price { font-family:var(--font-spacemono),monospace; font-weight:700; color:var(--sawah-deep); margin-top:8px; font-size:13px; }
        .demand-body .old { text-decoration:line-through; color:#A79E7C; font-weight:400; font-size:11px; margin-left:6px; }
        .demand-cta { margin-top:10px; width:100%; background:var(--gold); color:#2A1D06; border:none; border-radius:999px; padding:8px 0; font-weight:700; font-size:11.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; font-family:inherit; }
        .cta-banner { background: var(--sawah); border-radius:18px; padding:36px 30px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; color:#EFE9C9; margin: 0 6px 30px; }
        .cta-banner h3 { font-size:22px; font-weight:700; margin:0 0 6px; max-width:420px; }
        .cta-banner p { font-size:12.5px; color:#CFE3B8; margin:0; }
        .land-footer { text-align:center; font-size:11px; color:var(--ink-soft); padding-bottom:22px; }
      `}</style>

      <div className="nav">
        <div className="nav-logo"><div className="box"><Sprout size={17} /></div>TaniSPPG</div>
        <div className="nav-links">
          <a href="#tentang">Tentang</a>
          <a href="#cara-kerja">Cara Kerja</a>
          <a href="#permintaan">Permintaan Aktif</a>
          <a href="#gabung">Gabung</a>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className="nav-icons"><Search size={16} /><Heart size={16} /></div>
          <button className="nav-cta" onClick={goDash}>Buka Dashboard <ArrowUpRight size={14} /></button>
        </div>
      </div>

      <div className="hero">
        <div className="hero-panel hero-main">
          <div>
            <div className="eyebrow">Program Makan Bergizi Gratis · Garut</div>
            <h1>Dari sawah ke dapur MBG, tanpa lewat <span className="accent">Jakarta</span></h1>
            <p>TaniSPPG menghubungkan dapur SPPG langsung dengan petani lokal lewat WhatsApp — bukan aplikasi baru, cuma pesan yang sudah biasa mereka pakai.</p>
            <div className="hero-ctas">
              <button className="btn btn-primary" onClick={goDash}>Buka Dashboard <ArrowUpRight size={15} /></button>
              <a href="#cara-kerja" className="btn btn-outline">Lihat cara kerja</a>
            </div>
          </div>
          <div className="hero-chips">
            <div className="chip">
              <div className="avatars"><span style={{ background: "#D9A62E" }} /><span style={{ background: "#B0522C" }} /><span style={{ background: "#8FAE7E" }} /></div>
              <div><div className="big">{ROSTER_SIZE}</div><div className="small">Petani<br />terdaftar</div></div>
            </div>
            <div className="chip">
              <Wheat size={16} color="#D9A62E" />
              <div><div className="small">Bahan aktif</div><div style={{ fontSize: 11, fontWeight: 700 }}>{ingredients.length} jenis diminta</div></div>
            </div>
          </div>
        </div>

        <div className="hero-panel hero-chat">
          <div className="wa-tag"><MessageCircle size={13} /> WhatsApp — Grup Petani Garut</div>
          <div className="wa-bubble out">SPPG Garut butuh 200kg wortel minggu depan. Balas: YA [jumlah] [harga]</div>
          <div className="wa-bubble">ada wortel 60kg pak, harga 8500/kg ya<div className="wa-meta">Pak Ujang, Cikajang ✓✓</div></div>
          <div className="wa-bubble">punya 80kg pak harga 8rb<div className="wa-meta">Bu Euis, Pasirwangi ✓✓</div></div>
        </div>

        <div className="hero-panel hero-crate">
          <svg viewBox="0 0 160 220" width="100%" style={{ maxWidth: 150 }} aria-hidden="true">
            <rect x="10" y="120" width="140" height="80" rx="6" fill="#8a6a3a" />
            <rect x="10" y="120" width="140" height="14" fill="#6f5329" />
            {[28, 58, 88, 118].map((x, i) => <rect key={i} x={x} y="120" width="4" height="80" fill="#6f5329" />)}
            <circle cx="55" cy="105" r="26" fill="#B0522C" />
            <circle cx="95" cy="100" r="30" fill="#3D7A4C" />
            <circle cx="120" cy="118" r="20" fill="#D9A62E" />
            <path d="M55 79 l6 -14 l6 14 z" fill="#3D7A4C" />
          </svg>
        </div>
      </div>

      <div className="hero-foot-strip">
        <span>Dipercaya oleh Gapoktan &amp; BUMDes di Kabupaten Garut</span>
        <span>Konsep pitch · Garuda Hacks 7.0</span>
      </div>

      <div className="about" id="tentang">
        <div>
          <div className="about-label">Masalah</div>
          <h2>Uang MBG <u>mengalir keluar</u> desa</h2>
        </div>
        <div>
          <div className="about-copy">
            <p>Dana MBG seharusnya menghidupkan ekonomi desa lewat pembelian bahan lokal. Tapi tanpa daftar petani yang jelas dan cara menggabungkan hasil panen kecil, SPPG lebih gampang pesan ke distributor besar di luar kota.</p>
            <p>TaniSPPG membalik alurnya: SPPG posting kebutuhan apa saja, petani balas lewat WhatsApp, AI merangking otomatis berdasarkan jarak, harga, dan keandalan.</p>
          </div>
          <div className="tile-grid">
            <div className="tile tile-stat"><div className="n">30rb+</div><div className="l">Gapoktan se-Indonesia</div></div>
            <div className="tile tile-illus">
              <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
                <path d="M0 70 Q25 55 50 68 T100 62 V100 H0 Z" fill="#2f4a34" opacity="0.9" />
                <path d="M0 82 Q25 70 50 80 T100 76 V100 H0 Z" fill="#1c2b1e" />
              </svg>
            </div>
            <div className="tile tile-dark"><div className="n">{ingredients.length} bahan</div><div className="l">Aktif diminta minggu ini</div></div>
            <div className="tile tile-stat"><div className="n">75rb+</div><div className="l">BUMDes mitra potensial</div></div>
          </div>
        </div>
      </div>

      <div className="services" id="cara-kerja">
        <div className="services-head">
          <h2><Route size={22} /> Cara Kerja</h2>
          <button className="btn-pill-outline" onClick={goDash}>Coba Simulasi <ArrowUpRight size={13} /></button>
        </div>
        <div className="services-grid">
          <div className="services-copy">
            <p>Semua alur dirancang supaya petani tidak perlu belajar aplikasi baru — cukup balas WhatsApp seperti biasa, dengan bahasa dan ejaan apa adanya. AI yang menyesuaikan, bukan sebaliknya.</p>
            <div className="flow-illus">
              <div className="flow-line"><Smartphone size={15} color="#D9A62E" /> Tanpa install app</div>
              <div className="flow-line"><Sparkles size={15} color="#D9A62E" /> AI baca bahasa santai</div>
              <div className="flow-line"><Handshake size={15} color="#D9A62E" /> Koperasi urus logistik</div>
            </div>
          </div>
          <AccordionList />
        </div>
      </div>

      <div className="demandsec" id="permintaan">
        <div className="demandsec-head">
          <h2>Permintaan Aktif Minggu Ini</h2>
          <button className="btn-pill-outline" onClick={goDash}>Kelola di Dashboard <ArrowUpRight size={13} /></button>
        </div>
        <div className="demand-grid">
          {ingredients.map((ing, i) => (
            <div className="demand-card" key={ing.id}>
              <div className="demand-thumb" style={{ background: ["#8FAE7E", "#D98E5A", "#B0522C", "#6FA46B", "#9AA85E", "#C98A3E"][i % 6] }}>
                <span className="demand-badge">{ing.tag || "Bahan"}</span>
                <IngredientGlyph id={ing.id} />
              </div>
              <div className="demand-body">
                <div className="name">{ing.name}</div>
                <div className="qty">Dibutuhkan {ing.demand}{ing.unit} minggu ini</div>
                <div className="price">{fmtRp(ing.distributorPrice * 0.72)}<span className="old">{fmtRp(ing.distributorPrice)}</span>/{ing.unit}</div>
                <button className="demand-cta" onClick={goDash}>Lihat Petani <ArrowUpRight size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cta-banner" id="gabung">
        <div>
          <h3>Petani atau pengelola SPPG?</h3>
          <p>Daftarkan Gapoktan atau dapur Anda untuk ikut pilot tahap pertama di Garut.</p>
        </div>
        <button className="btn btn-primary"><ShoppingBasket size={15} /> Gabung sebagai mitra</button>
      </div>

      <div className="land-footer">TaniSPPG — konsep untuk Garuda Hacks 7.0</div>
    </div>
  );
}
