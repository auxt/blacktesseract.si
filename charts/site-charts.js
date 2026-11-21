/* blacktesseract.si · Live markets: TesseractCharts' chart engine (chartpro.js, studies.js, ta.js, unchanged) fed straight
   from Hyperliquid's public API in the visitor's browser: every perp on the main exchange and the xyz, para and io builder
   exchanges (stocks, ETFs, indices, commodities, FX, rates, pre-IPO), candles from /info, the live bar, the order book and
   the tape over one WebSocket. Public market data only: nothing here comes from TesseractAlpha's books or signals. */
import { ProChart } from "./chartpro.js";
import * as ST from "./studies.js";

const API = "https://api.hyperliquid.xyz/info", WSU = "wss://api.hyperliquid.xyz/ws";
const DEXES = ["", "xyz", "para", "io"];
const NONCRYPTO = {"commodity":["xyz:BRENTOIL","xyz:CL","xyz:COPPER","xyz:GOLD","xyz:NATGAS","xyz:PALLADIUM","xyz:PLATINUM","xyz:SILVER"],"etf":["io:EWY","para:GDX","para:SMH","xyz:EWJ","xyz:EWT","xyz:EWY","xyz:EWZ","xyz:KORU","xyz:MAGS","xyz:SMH","xyz:SOXL","xyz:TLT","xyz:XLE"],"fx":["xyz:EUR","xyz:GBP","xyz:JPY"],"index":["xyz:JP225","xyz:KR200","xyz:NIFTY","xyz:SP500","xyz:XYZ100"],"preipo":["io:ANTH","io:OAI","para:ANTH","xyz:SHEIN"],"rates":["para:10Y","para:2Y","para:30Y"]};
const CLS_OF = new Map(); for (const [k, arr] of Object.entries(NONCRYPTO)) for (const m of arr) CLS_OF.set(m, k);
const CLASSES = [["fav", "★"], ["crypto", "Crypto"], ["stock", "Stocks"], ["etf", "ETFs"], ["index", "Indices"], ["commodity", "Commodities"], ["fx", "FX"], ["rates", "Rates"], ["preipo", "Pre-IPO"]];
const IVS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const IVMS = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const OPT = [["ma", "MA"], ["vwap", "VWAP"], ["bb", "BB"], ["st", "Supertrend"], ["rsi", "RSI"], ["macd", "MACD"]];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
function pxDp(v) { const a = Math.abs(v || 0); return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7; }
const fpx = (v, dp) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: dp == null ? pxDp(v) : dp, maximumFractionDigits: dp == null ? pxDp(v) : dp }));
const fsz = (v) => (v == null || !isFinite(v) ? "–" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "k" : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));
const big = (v) => (v == null || !isFinite(v) ? "–" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0));
const pct = (v, dp = 2) => (v == null || !isFinite(v) ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(dp) + "%");
const sym = (m) => (m.includes(":") ? m.split(":")[1] : m);
const dexOf = (m) => (m.includes(":") ? m.split(":")[0] : "");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } },
};
const post = (b) => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
  .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });

// ---------------------------------------------------------------------------------------------------------- colours
const cc = document.createElement("canvas").getContext("2d");
function rgba(c, a) { cc.fillStyle = "#000"; cc.fillStyle = c; const h = cc.fillStyle; if (h[0] !== "#") return h; const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function palette() {
  const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
  const up = v("--green", "#39ff88"), dn = v("--red", "#ff2a6d"), ink = v("--ink", "#f6eeff"), ink2 = v("--ink2", "#c9b8ec"), ink3 = v("--ink3", "#8270ad"),
    line = "rgba(255,43,214,0.22)", bg = "#0a0414", cy = v("--cyan", "#00f0ff"), mag = v("--magenta", "#ff2bd6"), am = v("--amber", "#fcee0a"), vi = v("--violet", "#b44cff");
  const fam = '"Share Tech Mono", ui-monospace, monospace';
  const P = { bg, grid: "rgba(255,43,214,0.07)", text: ink2, textStrong: ink, axisLine: line, sep: line, cross: ink3, crossBg: ink2, crossFg: bg, up, down: dn, line: cy,
    areaTop: rgba(cy, 0.25), areaBot: rgba(cy, 0.02), watermark: rgba(mag, 0.07), hlLabel: ink2, draw: cy, series: [cy, am, vi, up, mag, ink3],
    volAlpha: 0.45, pos: cy, sl: dn, tp: up, liq: am, statBg: rgba(bg, 0.9), statBorder: line, fib: [ink3, dn, am, up, up, cy, ink3],
    radius: 2, hlLabels: true, family: fam, font: `11px ${fam}`, fontSmall: `10px ${fam}`, lastDash: [1, 2], crossDash: [5, 4],
    ink, ink2, ink3, cy, amber: am, violet: vi };
  P.volUp = rgba(up, 0.4); P.volDown = rgba(dn, 0.4); P.measureUp = up; P.measureDown = dn;
  return P;
}
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, w, h];
}

// ---------------------------------------------------------------------------------------------------------- the widget
export function mount(root) {
  const P = palette();
  const font = (px, w) => `${w || 400} ${px}px ${P.family}`;
  let S = store.get("bt-mk", null);
  if (!S || typeof S !== "object") S = {};
  S = Object.assign({ m: "BTC", iv: "15m", cls: "crypto", q: "", favs: ["BTC", "ETH", "SOL", "HYPE", "xyz:GOLD", "xyz:SP500", "xyz:NVDA"], on: { ma: true } }, S);
  if (!IVS.includes(S.iv)) S.iv = "15m";
  const save = () => store.set("bt-mk", S);

  root.innerHTML = `
  <aside class="mk-list">
    <input class="mk-q" id="mkQ" type="search" placeholder="Search markets" aria-label="Search markets" autocomplete="off" spellcheck="false">
    <div class="mk-cls" id="mkCls" role="tablist"></div>
    <div class="mk-rows" id="mkRows" role="listbox" aria-label="Markets"><div class="mk-note">Loading markets…</div></div>
    <div class="mk-count" id="mkCount"></div>
  </aside>
  <div class="mk-main">
    <div class="mk-head">
      <div class="mk-id"><span class="mk-sym" id="mkSym">–</span><span class="mk-vb" id="mkVb"></span></div>
      <span class="mk-px" id="mkPx">–</span>
      <span class="mk-stat" id="mkChg"></span>
      <span class="mk-stat" id="mkVol"></span>
      <span class="mk-stat mk-hide-s" id="mkFund"></span>
      <span class="mk-stat mk-hide-s" id="mkOi"></span>
      <div class="mk-tools">
        <div class="seg mk-iv" id="mkIv"></div>
        <div class="mk-ind" id="mkInd"></div>
        <button class="btn sm mk-full-btn" id="mkFull" title="Full screen (Esc to leave)" aria-label="Full screen"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      </div>
    </div>
    <div class="mk-chart" id="mkChart"></div>
  </div>
  <div class="mk-side">
    <div class="mk-sh"><span>Order book</span><span class="mk-live" id="mkLive"><i></i>connecting</span></div>
    <canvas id="mkDom" aria-label="Order book ladder"></canvas>
    <div class="mk-sh"><span>Trades</span><span class="small" id="mkTn"></span></div>
    <div class="mk-tape" id="mkTape"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);

  // ----------------------------------------------------------------- markets
  let ROWS = [], BY = new Map();
  async function loadMarkets() {
    const res = await Promise.allSettled(DEXES.map((d) => post(d ? { type: "metaAndAssetCtxs", dex: d } : { type: "metaAndAssetCtxs" })));
    const rows = [];
    res.forEach((r, k) => {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
      const dex = DEXES[k], [meta, ctxs] = r.value;
      (meta && meta.universe || []).forEach((u, i) => {
        if (!u || u.isDelisted) return;
        let name = String(u.name || ""); if (!name) return;
        if (dex && !name.includes(":")) name = dex + ":" + name;
        const c = ctxs && ctxs[i] || {}, px = num(c.markPx) || num(c.midPx), prev = num(c.prevDayPx), oi = num(c.openInterest);
        rows.push({ m: name, sym: sym(name), dex, cls: dex ? (CLS_OF.get(name) || "stock") : "crypto", px, chg: px && prev ? px / prev - 1 : null,
          vol: num(c.dayNtlVlm), fund: num(c.funding), oi: oi != null && px ? oi * px : null, szd: u.szDecimals });
      });
    });
    if (!rows.length) throw new Error("no markets");
    ROWS = rows; BY = new Map(rows.map((r) => [r.m, r]));
    if (!BY.has(S.m)) S.m = "BTC";
    drawCls(); drawList(); head();
  }
  function drawCls() {
    const n = {}; for (const r of ROWS) n[r.cls] = (n[r.cls] || 0) + 1;
    n.fav = S.favs.filter((m) => BY.has(m)).length;
    $("#mkCls").innerHTML = CLASSES.filter(([k]) => n[k]).map(([k, t]) => `<button role="tab" data-c="${k}" aria-pressed="${S.cls === k}" title="${k === "fav" ? "Favourites" : t}">${t}<i>${n[k]}</i></button>`).join("");
  }
  function drawList() {
    const q = S.q.trim().toUpperCase();
    let list = q ? ROWS.filter((r) => r.sym.toUpperCase().includes(q) || r.m.toUpperCase().includes(q))
      : S.cls === "fav" ? S.favs.map((m) => BY.get(m)).filter(Boolean) : ROWS.filter((r) => r.cls === S.cls);
    if (S.cls !== "fav" || q) list = list.slice().sort((a, b) => (b.vol || 0) - (a.vol || 0));
    $("#mkCount").textContent = `${list.length} of ${ROWS.length} markets · by 24h volume`;
    list = list.slice(0, 160);
    $("#mkRows").innerHTML = list.length ? list.map((r) => `<button class="mk-row${r.m === S.m ? " on" : ""}" data-m="${esc(r.m)}" role="option" aria-selected="${r.m === S.m}">` +
      `<span class="s"><b class="star${S.favs.includes(r.m) ? " on" : ""}" data-star="${esc(r.m)}" title="Favourite">★</b>${esc(r.sym)}${r.dex ? `<em>${esc(r.dex)}</em>` : ""}</span>` +
      `<span class="p">${fpx(r.px)}</span><span class="c ${r.chg == null ? "" : r.chg >= 0 ? "up" : "dn"}">${pct(r.chg)}</span></button>`).join("")
      : `<div class="mk-note">No market matches.</div>`;
  }
  $("#mkCls").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.cls = b.dataset.c; S.q = ""; $("#mkQ").value = ""; save(); drawCls(); drawList(); });
  $("#mkQ").addEventListener("input", (e) => { S.q = e.target.value; drawList(); });
  $("#mkRows").addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { e.stopPropagation(); const m = st.dataset.star, i = S.favs.indexOf(m); if (i >= 0) S.favs.splice(i, 1); else S.favs.push(m); save(); drawCls(); drawList(); return; }
    const b = e.target.closest(".mk-row"); if (b) select(b.dataset.m);
  });

  // ----------------------------------------------------------------- header and controls
  $("#mkIv").innerHTML = IVS.map((iv) => `<button data-iv="${iv}" aria-pressed="${iv === S.iv}">${iv}</button>`).join("");
  $("#mkIv").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.dataset.iv === S.iv) return; S.iv = b.dataset.iv; save(); $$iv(); loadBars(); live.resub(); });
  const $$iv = () => root.querySelectorAll("#mkIv button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.iv === S.iv ? "true" : "false"));
  $("#mkInd").innerHTML = OPT.map(([k, t]) => `<button data-k="${k}" aria-pressed="${!!S.on[k]}" title="${esc(ST.IND[k].desc)}">${t}</button>`).join("");
  $("#mkInd").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.k; S.on[k] = !S.on[k]; b.setAttribute("aria-pressed", S.on[k] ? "true" : "false"); save(); draw(true); });
  function head() {
    const r = BY.get(S.m) || {}, px = L.px != null ? L.px : r.px;
    $("#mkSym").textContent = sym(S.m);
    $("#mkVb").textContent = r.dex ? r.dex + " · Hyperliquid" : "Hyperliquid";
    $("#mkPx").textContent = fpx(px);
    const chg = r.px && r.chg != null && px ? (px / (r.px / (1 + r.chg)) - 1) : r.chg;
    $("#mkChg").innerHTML = `24h <b class="${chg == null ? "" : chg >= 0 ? "up" : "dn"}">${pct(chg)}</b>`;
    $("#mkVol").innerHTML = `vol <b>${big(r.vol)}</b>`;
    $("#mkFund").innerHTML = `funding <b class="${r.fund == null ? "" : r.fund >= 0 ? "up" : "dn"}">${r.fund == null ? "–" : (r.fund * 100).toFixed(4) + "%/h"}</b>`;
    $("#mkOi").innerHTML = `OI <b>${big(r.oi)}</b>`;
  }
  function select(m) {
    if (m === S.m) return;
    S.m = m; save();
    root.querySelectorAll(".mk-row").forEach((b) => { const on = b.dataset.m === m; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    L.b = []; L.a = []; L.tr = []; L.px = null; domSt.prev = {}; domSt.flash = {};
    head(); drawTape(true); drawDom(); loadBars(); live.resub();
  }

  // ----------------------------------------------------------------- the chart
  const chart = new ProChart($("#mkChart"), { palette: P });
  chart.setMessage("loading…");
  let bars = null, built = null, hoverI = null, legendQ = false, loadSeq = 0;
  chart.on("hover", (i) => { hoverI = i; if (!legendQ) { legendQ = true; requestAnimationFrame(() => { legendQ = false; legend(); }); } });
  async function loadBars() {
    const seq = ++loadSeq, m = S.m, iv = S.iv, ms = IVMS[iv], now = Date.now();
    chart.setMessage(`loading ${sym(m)} ${iv}…`);
    try {
      const rows = await post({ type: "candleSnapshot", req: { coin: m, interval: iv, startTime: now - ms * 600, endTime: now } });
      if (seq !== loadSeq) return;
      if (!Array.isArray(rows) || !rows.length) { chart.setMessage("no candles for this market yet"); bars = null; return; }
      bars = { key: m + "|" + iv, ms, t: [], o: [], h: [], l: [], c: [], v: [] };
      for (const r of rows) { bars.t.push(r.t); bars.o.push(+r.o); bars.h.push(+r.h); bars.l.push(+r.l); bars.c.push(+r.c); bars.v.push(+r.v); }
      draw(false);
    } catch (e) { if (seq === loadSeq) chart.setMessage("the candles did not load · retrying"); setTimeout(() => { if (seq === loadSeq) loadBars(); }, 8000); }
  }
  function arrays() { const n = bars.t.length; return { t: bars.t, o: bars.o, h: bars.h, l: bars.l, c: bars.c, v: bars.v, n, closedN: n - 1, barMs: bars.ms, key: bars.key }; }
  function draw(keep) {
    if (!bars) return;
    const A = arrays(), dp = pxDp(A.c[A.n - 1]);
    const price = [{ kind: "candles", style: "candles", o: A.o, h: A.h, l: A.l, c: A.c }];
    const panes = [{ id: "price", weight: 3, series: price }], outs = {}, inds = [];
    const cx = { dp, fpx, rgba, perp: null, since: (t) => new Date(t).toISOString().slice(5, 16).replace("T", " ") };
    const want = ["vol", ...OPT.map(([k]) => k).filter((k) => S.on[k])];
    for (const id of want) {
      const def = ST.IND[id], x = { id, on: true, p: ST.defaults(id) };
      let r; try { r = ST.compute(id, x.p, A, P, cx); } catch (e) { console.error("indicator " + id, e); continue; }
      outs[id] = r; inds.push(x);
      if (def.pane === "price") price.push(...r.series);
      else panes.push({ id, weight: 0.9, series: r.series, fixed: r.fixed, ticks: r.ticks, fmt: r.fmt || ((v) => fpx(v, dp)) });
    }
    chart.pxFmt = (v) => fpx(v, dp);
    chart.timeFmt = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
    chart.watermark = sym(S.m);
    built = { A, outs, inds, f: (v) => fpx(v, dp) };
    chart.setPanes(panes);
    chart.setData(A, { keepView: keep });
    legend();
  }
  function legend() {
    if (!built || !built.A.n) return;
    const A = built.A, i = hoverI == null ? A.n - 1 : Math.max(0, Math.min(A.n - 1, hoverI));
    const hd = `<b class="sy">${esc(sym(S.m))}</b><span class="t2">${esc(S.iv)} · Hyperliquid</span>`;
    const Lg = ST.legends(built, i, hd);
    chart.setLegend("price", Lg.price || "");
    for (const x of built.inds) if (ST.IND[x.id].pane === "own") chart.setLegend(x.id, Lg[x.id] || "");
  }
  let drawQ = false;
  function onCandle(k) {
    if (!bars || k.s !== S.m || k.i !== S.iv) return;
    const n = bars.t.length, last = bars.t[n - 1], t = +k.t;
    if (t === last) { bars.o[n - 1] = +k.o; bars.h[n - 1] = +k.h; bars.l[n - 1] = +k.l; bars.c[n - 1] = +k.c; bars.v[n - 1] = +k.v; }
    else if (t > last) { bars.t.push(t); bars.o.push(+k.o); bars.h.push(+k.h); bars.l.push(+k.l); bars.c.push(+k.c); bars.v.push(+k.v); }
    else return;
    if (!drawQ) { drawQ = true; setTimeout(() => { drawQ = false; draw(true); }, 250); }
  }

  // ----------------------------------------------------------------- the order book ladder
  const L = { b: [], a: [], tr: [], px: null };
  const domSt = { prev: {}, flash: {} };
  const domCv = $("#mkDom");
  function note(c, w, h, t) { c.fillStyle = P.ink3; c.font = font(11); c.textAlign = "center"; c.fillText(t, w / 2, h / 2); }
  function drawDom() {
    const [c, w, h] = fit(domCv);
    c.clearRect(0, 0, w, h);
    if (!L.b.length && !L.a.length) return note(c, w, h, "waiting for the book…");
    const rowH = 17, footer = 34, rows = Math.max(4, Math.floor((h - footer - 18) / rowH)), half = Math.floor(rows / 2);
    const asks = L.a.slice(0, half).reverse(), bids = L.b.slice(0, rows - asks.length);
    const lv = [...asks.map((x) => [x[0], x[1], "a"]), ...bids.map((x) => [x[0], x[1], "b"])];
    const mx = Math.max(...lv.map((x) => x[1]), 1e-12), dp = pxDp(L.b[0] ? L.b[0][0] : L.a[0][0]);
    const cumA = []; let ca = 0; for (let i = asks.length - 1; i >= 0; i--) { ca += asks[i][1]; cumA[i] = ca; }
    let cb = 0; const cumB = bids.map((x) => (cb += x[1]));
    const cx = w / 2, now = performance.now(), prev = domSt.prev, next = {}, wide = w >= 300;
    c.font = font(10); c.fillStyle = P.ink3; c.textAlign = "left"; c.fillText("bids", 8, 12); c.textAlign = "right"; c.fillText("asks", w - 8, 12); c.textAlign = "center"; c.fillText("price", cx, 12);
    lv.forEach(([px, sz, side], i) => {
      const y = 18 + i * rowH, bar = (sz / mx) * (cx - (wide ? 46 : 40)), isA = side === "a", key = side + px;
      next[key] = sz;
      const was = prev[key];
      if (was != null && Math.abs(was - sz) > 1e-12) domSt.flash[key] = { t: now, up: sz > was };
      const f = domSt.flash[key], fa = f ? Math.max(0, 1 - (now - f.t) / 500) : 0;
      if (fa > 0) { c.fillStyle = rgba(f.up ? P.up : P.down, 0.22 * fa); c.fillRect(0, y, w, rowH - 1); } else if (f) delete domSt.flash[key];
      const best = (isA && i === asks.length - 1) || (!isA && i === asks.length);
      if (best) { c.fillStyle = rgba(isA ? P.down : P.up, 0.1); c.fillRect(0, y, w, rowH - 1); }
      c.fillStyle = rgba(isA ? P.down : P.up, (best ? 0.7 : 0.38) * (wide ? 1 : 0.6));
      if (isA) c.fillRect(cx + 40, y + 2, bar, rowH - 5); else c.fillRect(cx - 40 - bar, y + 2, bar, rowH - 5);
      c.font = font(11, best ? 700 : 400); c.fillStyle = isA ? P.down : P.up; c.textAlign = "center"; c.fillText(fpx(px, dp), cx, y + 12.5);
      c.fillStyle = P.ink; c.font = font(10.5); c.textAlign = isA ? "right" : "left";
      c.fillText(fsz(sz), isA ? w - 6 : 6, y + 12.5);
      if (wide) { c.fillStyle = P.ink3; c.font = font(9.5); c.fillText(fsz(isA ? cumA[i] : cumB[i - asks.length]), isA ? w - 52 : 52, y + 12.5); }
    });
    domSt.prev = next;
    if (L.px != null) {
      const all = lv.map((x) => x[0]); let j = 0; for (let i = 0; i < all.length; i++) if (Math.abs(all[i] - L.px) < Math.abs(all[j] - L.px)) j = i;
      c.fillStyle = P.cy; c.beginPath(); const yy = 18 + j * rowH + rowH / 2; c.moveTo(cx - 34, yy - 4); c.lineTo(cx - 28, yy); c.lineTo(cx - 34, yy + 4); c.fill();
    }
    const bb = L.b[0] && L.b[0][0], ba = L.a[0] && L.a[0][0], sp = bb && ba ? ba - bb : null, mid = bb && ba ? (ba + bb) / 2 : null;
    const sb = L.b.slice(0, 10).reduce((s, x) => s + x[1] * x[0], 0), sa = L.a.slice(0, 10).reduce((s, x) => s + x[1] * x[0], 0), imb = sb + sa ? sb / (sb + sa) : 0.5;
    const fy = h - footer + 6;
    c.fillStyle = rgba(P.up, 0.55); c.fillRect(8, fy + 14, (w - 16) * imb, 6); c.fillStyle = rgba(P.down, 0.55); c.fillRect(8 + (w - 16) * imb, fy + 14, (w - 16) * (1 - imb), 6);
    c.font = font(10); c.fillStyle = P.ink2; c.textAlign = "left";
    c.fillText(`spread ${sp == null ? "–" : fpx(sp, dp)} · ${sp && mid ? (sp / mid * 1e4).toFixed(1) + " bps" : "–"}`, 8, fy + 8);
    c.textAlign = "right"; c.fillText(`top 10 ${(imb * 100).toFixed(0)}% bid`, w - 8, fy + 8);
  }
  new ResizeObserver(() => drawDom()).observe(domCv);

  // ----------------------------------------------------------------- the tape
  const tapeEl = $("#mkTape");
  function drawTape(clear) {
    if (clear) { tapeEl.innerHTML = `<div class="mk-note">waiting for trades…</div>`; $("#mkTn").textContent = ""; return; }
    const dp = L.px != null ? pxDp(L.px) : 2;
    tapeEl.innerHTML = `<div class="r h"><span>time</span><span>price</span><span>size</span></div>` + L.tr.slice(0, 60).map((t) =>
      `<div class="r ${t.buy ? "up" : "dn"}${t.big ? " big" : ""}"><span>${new Date(t.time).toISOString().slice(11, 19)}</span><span>${fpx(t.px, dp)}</span><span>${fsz(t.sz)}</span></div>`).join("");
  }
  drawTape(true);

  // ----------------------------------------------------------------- one WebSocket for the market on screen
  const live = (() => {
    let ws = null, subs = [], want = false, backoff = 1, pingT = 0, openT = 0, retryT = 0;
    const status = (t, ok) => { const el = $("#mkLive"); el.className = "mk-live" + (ok ? " ok" : ""); el.innerHTML = `<i></i>${t}`; };
    const mine = () => [{ type: "candle", coin: S.m, interval: S.iv }, { type: "l2Book", coin: S.m }, { type: "trades", coin: S.m }];
    const send = (o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) { /* closed */ } };
    function open() {
      if (ws || !want) return;
      status("connecting");
      ws = new WebSocket(WSU);
      ws.onopen = () => { backoff = 1; subs = mine(); subs.forEach((s) => send({ method: "subscribe", subscription: s })); status("live", true);
        clearInterval(pingT); pingT = setInterval(() => send({ method: "ping" }), 30000); };
      ws.onmessage = (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (d.channel === "candle") onCandle(d.data);
        else if (d.channel === "l2Book" && d.data && d.data.coin === S.m) {
          const lv = d.data.levels || [[], []];
          L.b = (lv[0] || []).map((x) => [+x.px, +x.sz]); L.a = (lv[1] || []).map((x) => [+x.px, +x.sz]);
          if (!domQ) { domQ = true; requestAnimationFrame(() => { domQ = false; drawDom(); }); }
        } else if (d.channel === "trades" && Array.isArray(d.data)) {
          const fresh = d.data.filter((t) => t.coin === S.m).map((t) => ({ time: t.time, px: +t.px, sz: +t.sz, buy: t.side === "B" }));
          if (!fresh.length) return;
          fresh.sort((a, b) => b.time - a.time);
          const med = L.tr.length ? L.tr.slice(0, 40).map((t) => t.px * t.sz).sort((a, b) => a - b)[Math.floor(Math.min(40, L.tr.length) / 2)] : 0;
          fresh.forEach((t) => { t.big = med && t.px * t.sz > med * 8; });
          L.tr = fresh.concat(L.tr).slice(0, 200); L.px = fresh[0].px;
          $("#mkTn").textContent = new Date(fresh[0].time).toISOString().slice(11, 19) + " UTC";
          if (!tapeQ) { tapeQ = true; requestAnimationFrame(() => { tapeQ = false; drawTape(); head(); }); }
        }
      };
      ws.onclose = () => { ws = null; clearInterval(pingT); if (want) { status(`reconnecting in ${backoff}s`); clearTimeout(retryT); retryT = setTimeout(open, backoff * 1000); backoff = Math.min(30, backoff * 2); } else status("paused"); };
      ws.onerror = () => { try { ws && ws.close(); } catch (e) { /* closing */ } };
    }
    let domQ = false, tapeQ = false;
    return {
      start() { want = true; clearTimeout(openT); open(); },
      stop() { want = false; clearTimeout(openT); openT = setTimeout(() => { if (!want && ws) { try { ws.close(); } catch (e) { /* closing */ } } }, 15000); },
      resub() { if (!ws || ws.readyState !== 1) return; subs.forEach((s) => send({ method: "unsubscribe", subscription: s })); subs = mine(); subs.forEach((s) => send({ method: "subscribe", subscription: s })); },
    };
  })();

  // ----------------------------------------------------------------- full screen
  const full = (on) => { root.classList.toggle("full", on); document.documentElement.classList.toggle("mk-lock", on); setTimeout(() => { chart.resize(); drawDom(); }, 50); };
  $("#mkFull").addEventListener("click", () => full(!root.classList.contains("full")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("full")) full(false); });

  // ----------------------------------------------------------------- go
  let statsT = 0, active = false;
  function setActive(on) {
    if (on === active) return; active = on;
    if (on) { live.start(); clearInterval(statsT); statsT = setInterval(() => loadMarkets().catch(() => {}), 30000); }
    else { live.stop(); clearInterval(statsT); }
  }
  head();
  loadMarkets().catch(() => { $("#mkRows").innerHTML = `<div class="mk-note">Markets did not load. Hyperliquid may be unreachable from this network.</div>`; });
  loadBars();
  setActive(true);
  return { setActive };
}
