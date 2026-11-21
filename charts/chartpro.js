// HyperLight's chart engine (Project HyperTrader, web/js/chartpro.js), copied for TesseractCharts on 14 Nov 2026; HyperLight is not changed.
// Chart engine for the chart (Manual trading), drawn on one canvas: a price pane and indicator panes stacked under it,
// a price scale per pane (auto, manual, logarithmic or percent), a shared time scale, crosshair with axis labels,
// last-price tag with a countdown to the bar's close, high / low labels, position lines and drawings.
// Interaction follows TradingView: drag to pan, wheel or pinch to zoom, drag a price scale to stretch it,
// drag the time scale to zoom, drag a pane border to resize, double-click a scale to reset it.
// Legends are HTML laid over the canvas (one box per pane) so their buttons are real buttons.

const TIME_W = { year: 60, month: 50, week: 35, day: 30, h12: 24, h6: 23, h4: 22, h3: 21, h1: 20, m30: 13, m15: 12, m5: 11, m1: 10 };
const MIN_PANE = 44;
const SEP_HIT = 5;
const AXIS_MIN = 58;

export const DRAW_TOOLS = ["trend", "ray", "hline", "vline", "rect", "fib", "measure"];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const ONE_POINT = new Set(["hline", "vline"]);

const isN = (x) => x !== null && x !== undefined && Number.isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function niceStep(range, target) {
  const raw = range / Math.max(target, 1);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 3.5 ? 2.5 : m < 7 ? 5 : 10) * p;
}
const round3 = (x) => { if (!x) return x; const p = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 2); return Math.round(x / p) * p; };

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function distSeg(px, py, x1, y1, x2, y2, ray = false) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let u = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  u = ray ? Math.max(0, u) : clamp(u, 0, 1);
  const qx = x1 + u * dx, qy = y1 + u * dy;
  return Math.hypot(px - qx, py - qy);
}

let uid = 0;
export const newId = () => `d${Date.now().toString(36)}${(uid++).toString(36)}`;

export class ProChart {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.P = opts.palette || {};
    this.d = null;                  // {t,o,h,l,c,v, n, closedN, barMs}
    this.panes = [];                // [{id, weight, series, fixed, fmt, manual, legend}]
    this.view = null;               // {i0, i1} fractional bar indices
    this.hover = null;              // {x, y, i, pane}
    this.scaleMode = "normal";      // price pane: normal | log | pct
    this.pxFmt = (v) => String(v);
    this.timeFmt = opts.timeFmt || ((t) => new Date(t).toISOString());
    this.tz = "local";
    this.magnet = false;
    this.tool = "cursor";
    this.drawings = [];
    this.selected = null;
    this.draft = null;              // drawing being placed
    this.measure = null;
    this.hideDrawings = false;
    this.rightBars = 8;
    this.msg = "Loading…";
    this.axisW = 64;
    this.watermark = "";
    this.stats = null;              // Bloomberg-style range stats box (computed in draw)
    this.showStats = false;
    this.countdown = true;
    this.listeners = {};
    this._raf = 0;

    this.root = document.createElement("div");
    this.root.className = "cxp-root";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "cxp-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.tabIndex = 0;
    this.over = document.createElement("canvas");              // the crosshair, redrawn alone as the mouse moves
    this.over.className = "cxp-over";
    this.legendLayer = document.createElement("div");
    this.legendLayer.className = "cxp-legends";
    this.root.append(this.canvas, this.over, this.legendLayer);
    host.appendChild(this.root);
    this.ctx = this.canvas.getContext("2d");
    this.octx = this.over.getContext("2d");
    this.legends = new Map();
    new ResizeObserver(() => this.resize()).observe(host);
    this._bind();
  }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) { try { f(...a); } catch (e) { console.error("chart " + ev, e); } } }

  // ------------------------------------------------------------------ data & config
  get N() { return this.d ? this.d.n : 0; }

  setPalette(P) { this.P = P; this.redraw(); }
  setMessage(m) { this.msg = m; this.d = null; this.view = null; this.redraw(); }

  setData(d, { keepView = false } = {}) {
    const old = this.d, ov = this.view;
    this.d = d;
    if (keepView && old && ov && old.key === d.key) {
      if (ov.i1 >= old.n - 0.5) {                              // following the latest bar: keep following
        const shift = d.n - old.n;
        this.setView(ov.i0 + shift, ov.i1 + shift, false);
      } else {                                                 // looking back: keep the same bars in view
        const j = clamp(Math.round(ov.i0), 0, old.n - 1);
        const k = this.indexOfTime(old.t[j]);
        const delta = k == null ? 0 : k - j;
        this.setView(ov.i0 + delta, ov.i1 + delta, false);
      }
    } else {
      this.reset(false);
      for (const p of this.panes) p.manual = null;
    }
    this.redraw();
  }

  setPanes(panes) {
    const prev = new Map(this.panes.map((p) => [p.id, p]));
    this.panes = panes.map((p) => Object.assign(p, { manual: prev.get(p.id) ? prev.get(p.id).manual : null }));
    for (const [id, el] of this.legends) if (!panes.some((p) => p.id === id)) { el.remove(); this.legends.delete(id); }
    for (const p of panes) {
      if (!this.legends.has(p.id)) {
        const el = document.createElement("div");
        el.className = "cxp-legend";
        el.dataset.pane = p.id;
        this.legendLayer.appendChild(el);
        this.legends.set(p.id, el);
      }
    }
    this.redraw();
  }

  setLegend(id, html) {
    const el = this.legends.get(id);
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
  }

  setRangeBars(nb) { this.rangeBars = nb; this.reset(); }

  reset(redraw = true) {
    const N = this.N;
    const span = clamp(this.rangeBars || 160, 20, Math.max(N + this.rightBars, 30));
    this.setView(N + this.rightBars - span, N + this.rightBars, redraw);
    for (const p of this.panes) p.manual = null;
  }

  setView(i0, i1, redraw = true) {
    const N = this.N;
    let span = Math.max(8, i1 - i0);
    span = Math.min(span, Math.max(N * 1.2 + 40, 60));
    const maxI1 = N + Math.max(this.rightBars, span * 0.5);
    const minI0 = -span * 0.5;
    if (i1 > maxI1) { i1 = maxI1; i0 = i1 - span; }
    if (i0 < minI0) { i0 = minI0; i1 = i0 + span; }
    i1 = i0 + span;
    this.view = { i0, i1 };
    if (redraw) { this.redraw(); this.emit("view", this.view); }
  }

  zoom(f, anchorX) {
    if (!this.view) return;
    const v = this.view, span = v.i1 - v.i0;
    const ns = clamp(span * f, 8, Math.max(this.N * 1.2 + 40, 60));
    const a = anchorX == null ? Math.min(v.i1, this.N - 1 + 0.5) : this.idxAt(anchorX);
    const i0 = a - ((a - v.i0) * ns) / span;
    this.setView(i0, i0 + ns);
  }

  pan(bars) { if (this.view) this.setView(this.view.i0 + bars, this.view.i1 + bars); }

  indexOfTime(t) {
    const T = this.d && this.d.t;
    if (!T || !T.length) return null;
    let lo = 0, hi = T.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] === t) return m; if (T[m] < t) lo = m + 1; else hi = m - 1; }
    return null;
  }
  // fractional index of any time (also between bars and beyond the last one)
  fIndex(t) {
    const T = this.d.t, n = T.length, bm = this.d.barMs;
    if (!n) return 0;
    if (t <= T[0]) return (t - T[0]) / bm;
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / bm;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo + (t - T[lo]) / Math.max(1, T[hi] - T[lo]);
  }
  timeAt(fi) {
    const T = this.d.t, n = T.length, bm = this.d.barMs;
    if (fi <= 0) return T[0] + fi * bm;
    if (fi >= n - 1) return T[n - 1] + (fi - (n - 1)) * bm;
    const i = Math.floor(fi);
    return T[i] + (fi - i) * (T[i + 1] - T[i]);
  }

  // ------------------------------------------------------------------ geometry
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    for (const cv of [this.canvas, this.over]) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + "px"; cv.style.height = h + "px";
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  layout() {
    const timeH = 26;
    const L = { plotL: 0, plotR: this.w - this.axisW, timeTop: this.h - timeH, timeH };
    L.plotW = Math.max(10, L.plotR - L.plotL);
    const total = L.timeTop;
    const ws = this.panes.map((p) => Math.max(0.05, p.weight || 1));
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    let y = 0;
    L.panes = this.panes.map((p, k) => {
      const hh = k === this.panes.length - 1 ? total - y : Math.max(MIN_PANE, Math.round((total * ws[k]) / sum));
      const r = { id: p.id, top: y, bot: y + hh, h: hh, pane: p };
      y += hh;
      return r;
    });
    return L;
  }
  barW() { return this.L.plotW / Math.max(this.view.i1 - this.view.i0, 1); }
  x(i) { return this.L.plotL + (i - this.view.i0 + 0.5) * this.barW(); }
  idxAt(x) { return (x - this.L.plotL) / this.barW() + this.view.i0 - 0.5; }
  paneAt(y) { return this.L ? this.L.panes.find((r) => y >= r.top && y < r.bot) || null : null; }

  // value transform for the price pane's scale mode
  tv(r, v) {
    if (r.id !== "price" || !isN(v)) return v;
    if (this.scaleMode === "log") return v > 0 ? Math.log(v) : null;
    if (this.scaleMode === "pct") return this.pctBase ? (v / this.pctBase - 1) * 100 : null;
    return v;
  }
  untv(r, u) {
    if (r.id !== "price") return u;
    if (this.scaleMode === "log") return Math.exp(u);
    if (this.scaleMode === "pct") return this.pctBase * (1 + u / 100);
    return u;
  }
  y(r, v) {
    const u = this.tv(r, v);
    if (!isN(u)) return null;
    const pad = r.padT, padB = r.padB;
    return r.top + pad + (1 - (u - r.y0) / (r.y1 - r.y0)) * (r.h - pad - padB);
  }
  valAt(r, y) {
    const u = r.y0 + (1 - (y - r.top - r.padT) / (r.h - r.padT - r.padB)) * (r.y1 - r.y0);
    return this.untv(r, u);
  }

  // ------------------------------------------------------------------ drawing
  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._oraf && cancelAnimationFrame(this._oraf); this._oraf = 0; this.draw(); });
  }
  redrawOverlay() {
    if (this._raf || this._oraf) return;
    this._oraf = requestAnimationFrame(() => { this._oraf = 0; this.drawOverlay(); });
  }
  drawOverlay() {
    const c = this.octx;
    if (!this.w) return;
    c.save();
    c.clearRect(0, 0, this.w, this.h);
    if (this.d && this.view && this.L) { c.font = this.P.font; this.drawCrosshair(c); }
    c.restore();
  }

  draw() {
    const c = this.ctx, P = this.P;
    if (!this.w) return;
    c.save();
    c.fillStyle = P.bg || "#131722";
    c.fillRect(0, 0, this.w, this.h);
    const font = P.font || "11px sans-serif";
    c.font = font;
    if (!this.d || !this.view || !this.panes.length) {
      c.fillStyle = P.text; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(this.msg || "", this.w / 2, this.h / 2);
      c.restore();
      this.octx.clearRect(0, 0, this.w, this.h);
      for (const el of this.legends.values()) el.style.display = "none";
      return;
    }
    for (const el of this.legends.values()) el.style.display = "";
    // axis width from the widest label we will draw
    this.L = this.layout();
    const v = this.view;
    const lo = Math.max(0, Math.floor(v.i0)), hi = Math.min(this.N - 1, Math.ceil(v.i1));
    this.lo = lo; this.hi = hi;
    this.pctBase = null;
    if (this.scaleMode === "pct") {
      const j = clamp(Math.ceil(v.i0), 0, this.N - 1);
      this.pctBase = this.d.c[j];
    }
    // compared markets: each rebased to the first bar on screen (shown on the percent scale)
    const j0 = clamp(Math.ceil(v.i0), 0, this.N - 1);
    for (const s of this.panes[0].series) {
      if (!s.cmp) continue;
      let base = null;
      for (let i = j0; i < s.values.length; i++) if (isN(s.values[i])) { base = s.values[i]; break; }
      const ref = this.d.c[j0];
      s._vals = base && ref ? s.values.map((x) => (isN(x) ? (ref * x) / base : null)) : s.values.map(() => null);
      s._base = base;
    }
    for (const r of this.L.panes) this.scaleFor(r, lo, hi);
    const want = this.measureAxis(c);
    if (Math.abs(want - this.axisW) > 6) { this.axisW = want; this.L = this.layout(); for (const r of this.L.panes) this.scaleFor(r, lo, hi); }
    const L = this.L;

    // watermark
    const pr = L.panes[0];
    if (this.watermark && P.watermark) {
      c.save();
      c.fillStyle = P.watermark; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `600 ${Math.round(clamp(pr.h * 0.16, 28, 72))}px ${P.family || "sans-serif"}`;
      c.fillText(this.watermark, L.plotL + L.plotW / 2, pr.top + pr.h / 2);
      c.restore();
      c.font = font;
    }

    // time grid + labels
    const ticks = this.timeTicks(lo, hi);
    c.lineWidth = 1;
    if (P.vgrid !== false) {
      c.strokeStyle = P.grid;
      for (const tk of ticks) {
        const xx = Math.round(this.x(tk.i)) + 0.5;
        c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, L.timeTop); c.stroke();
      }
    }
    // panes
    for (const r of L.panes) this.drawPane(c, r, lo, hi);
    // separators
    c.strokeStyle = P.sep || P.axisLine;
    for (const r of L.panes.slice(1)) { c.beginPath(); c.moveTo(0, r.top + 0.5); c.lineTo(this.w, r.top + 0.5); c.stroke(); }
    // axes frame
    c.strokeStyle = P.axisLine;
    c.beginPath(); c.moveTo(L.plotR + 0.5, 0); c.lineTo(L.plotR + 0.5, this.h); c.stroke();
    c.beginPath(); c.moveTo(0, L.timeTop + 0.5); c.lineTo(this.w, L.timeTop + 0.5); c.stroke();
    // time labels
    c.fillStyle = P.text; c.textAlign = "center"; c.textBaseline = "middle";
    for (const tk of ticks) {
      const xx = this.x(tk.i);
      if (xx < L.plotL + 16 || xx > L.plotR - 16) continue;
      c.font = tk.w >= TIME_W.day ? `600 ${font}` : font;
      c.fillStyle = tk.w >= TIME_W.month ? (P.textStrong || P.text) : P.text;
      c.fillText(tk.label, xx, L.timeTop + L.timeH / 2);
    }
    c.font = font;
    c.restore();
    this.drawOverlay();
    this.placeLegends();
    this.canvas.setAttribute("aria-label", this.opts.aria ? this.opts.aria() : "Price chart");
  }

  measureAxis(c) {
    let w = 0;
    c.font = this.P.font;
    for (const r of this.L.panes) {
      const f = r.pane.id === "price" ? this.axisLabel.bind(this, r) : r.pane.fmt || ((x) => String(Math.round(x * 100) / 100));
      for (const u of [r.y0, r.y1, (r.y0 + r.y1) / 2]) {
        const val = r.pane.id === "price" ? this.untv(r, u) : u;
        if (isN(val)) w = Math.max(w, c.measureText(f(val)).width);
      }
    }
    if (this.d) { const last = this.d.c[this.N - 1]; if (isN(last)) w = Math.max(w, c.measureText(this.pxFmt(last)).width); }
    return clamp(Math.ceil(w + 22), AXIS_MIN, 120);
  }

  axisLabel(r, v) {
    if (this.scaleMode === "pct") { const u = this.tv(r, v); return isN(u) ? `${u >= 0 ? "" : "−"}${Math.abs(u).toFixed(Math.abs(u) < 10 ? 2 : 1)}%` : ""; }
    return this.pxFmt(v);
  }

  scaleFor(r, lo, hi) {
    const p = r.pane;
    const isPrice = p.id === "price";
    r.padT = isPrice ? Math.max(14, r.h * 0.08) : Math.min(22, Math.max(8, r.h * 0.2));   // room for the pane's legend
    r.padB = isPrice ? Math.max(10, r.h * 0.06) : 6;
    r.empty = false;
    if (p.manual) { r.y0 = p.manual.y0; r.y1 = p.manual.y1; return; }
    if (p.fixed) { r.y0 = p.fixed[0]; r.y1 = p.fixed[1]; return; }
    let y0 = Infinity, y1 = -Infinity;
    const take = (val) => { const u = this.tv(r, val); if (isN(u)) { if (u < y0) y0 = u; if (u > y1) y1 = u; } };
    for (const s of p.series) {
      if (s.scale === false || s.hidden) continue;
      if (s.kind === "candles") { for (let i = lo; i <= hi; i++) { take(s.h[i]); take(s.l[i]); } }
      else if (s.kind === "line") { const vals = s._vals || s.values; for (let i = lo; i <= hi; i++) take(vals[i]); }
      else if (s.kind === "band") { for (let i = lo; i <= hi; i++) { take(s.upper[i]); take(s.lower[i]); } }
      else if (s.kind === "hist") {
        let any = false;
        for (let i = lo; i <= hi; i++) if (isN(s.values[i])) { take(s.values[i]); any = true; }
        if (any) take(s.base || 0);
      }
      else if (s.kind === "hline" && s.scale) take(s.value);
    }
    r.empty = !Number.isFinite(y0);
    if (r.empty) { y0 = 0; y1 = 1; }
    if (p.include) for (const x of p.include) { const u = this.tv(r, x); if (isN(u)) { y0 = Math.min(y0, u); y1 = Math.max(y1, u); } }
    let span = y1 - y0;
    if (!(span > 0)) span = Math.max(Math.abs(y1) * 0.01, 1e-9);
    r.y0 = y0 - (y1 - y0 === 0 ? span / 2 : 0);
    r.y1 = y1 + (y1 - y0 === 0 ? span / 2 : 0);
  }

  drawPane(c, r, lo, hi) {
    const P = this.P, L = this.L, p = r.pane;
    // horizontal grid and price labels
    const ticks = this.valueTicks(r);
    c.save();
    c.beginPath(); c.rect(L.plotL, r.top, L.plotW, r.h); c.clip();
    if (P.hgrid !== false) {
      c.strokeStyle = P.grid; c.lineWidth = 1;
      for (const t of ticks) { const yy = Math.round(t.y) + 0.5; c.beginPath(); c.moveTo(L.plotL, yy); c.lineTo(L.plotR, yy); c.stroke(); }
    }
    // background shading, zones, bands, then the rest in order
    for (const s of p.series) if (!s.hidden && (s.kind === "shade" || s.kind === "zone" || s.kind === "boxes" || s.kind === "profile")) this.drawSeries(c, r, s, lo, hi);
    for (const s of p.series) if (!s.hidden && s.kind === "volume") this.drawVolume(c, r, s, lo, hi);
    for (const s of p.series) if (!s.hidden && s.kind === "band") this.drawSeries(c, r, s, lo, hi);
    for (const s of p.series) if (!s.hidden && !["shade", "zone", "band", "volume", "boxes", "profile"].includes(s.kind)) this.drawSeries(c, r, s, lo, hi);
    if (p.id === "price") {
      if (!this.hideDrawings) this.drawDrawings(c, r);
      this.drawHighLow(c, r, lo, hi);
      if (this.showStats) this.drawStats(c, r, lo, hi);
    }
    c.restore();
    // value tags on the scale (series last values, lines, last price), then the tick labels they leave free
    const tags = this.drawTags(c, r) || [];
    c.fillStyle = P.text; c.textAlign = "left"; c.textBaseline = "middle"; c.font = P.font;
    for (const t of ticks) {
      if (t.y <= r.top + 7 || t.y >= r.bot - 7) continue;
      if (tags.some((q) => Math.abs(q.y - t.y) < q.h / 2 + 6)) continue;
      c.fillText(t.label, L.plotR + 7, t.y);
    }
  }

  valueTicks(r) {
    if (r.empty && !r.pane.manual) return [];                  // nothing on screen in this pane: no scale
    const n = Math.max(2, Math.floor(r.h / 46));
    const out = [];
    const p = r.pane;
    const fmt = p.id === "price" ? (val) => this.axisLabel(r, val) : p.fmt || ((x) => String(x));
    if (p.id === "price" && this.scaleMode === "log") {
      const a = r.y0, b = r.y1, st = (b - a) / n;
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const val = round3(Math.exp(a + st * (k + 0.5)));
        if (val === prev) continue;
        prev = val;
        out.push({ y: this.y(r, val), label: fmt(val) });
      }
      return out;
    }
    if (p.ticks) return p.ticks.map((val) => ({ y: this.yRaw(r, val), label: fmt(val) }));
    const step = niceStep(r.y1 - r.y0, n);
    for (let u = Math.ceil(r.y0 / step) * step; u <= r.y1 + step * 1e-9; u += step) {
      const val = p.id === "price" ? this.untv(r, u) : u;
      out.push({ y: this.yRaw(r, u), label: fmt(Math.abs(val) < step * 1e-6 ? 0 : val) });
    }
    return out;
  }
  yRaw(r, u) { return r.top + r.padT + (1 - (u - r.y0) / (r.y1 - r.y0)) * (r.h - r.padT - r.padB); }

  drawSeries(c, r, s, lo, hi) {
    const P = this.P, bw = this.barW(), L = this.L;
    c.globalAlpha = 1;
    switch (s.kind) {
      case "candles": return this.drawCandles(c, r, s, lo, hi);
      case "line": {
        const vals = s._vals || s.values;
        c.lineWidth = s.width || 1.5; c.lineJoin = "round"; c.lineCap = "round";
        c.globalAlpha = s.alpha == null ? 1 : s.alpha;
        c.setLineDash(s.dash || []);
        if (s.colors) {                                        // colour per segment (direction-coloured lines)
          for (let i = Math.max(lo, 1); i <= hi; i++) {
            const a = vals[i - 1], b = vals[i];
            if (!isN(a) || !isN(b) || !s.colors[i]) continue;
            const y0 = this.y(r, a), y1 = this.y(r, b);
            c.strokeStyle = s.colors[i];
            c.beginPath();
            if (s.step) { c.moveTo(this.x(i - 1), y0); c.lineTo(this.x(i), y0); c.lineTo(this.x(i), y1); }
            else { c.moveTo(this.x(i - 1), y0); c.lineTo(this.x(i), y1); }
            c.stroke();
          }
        } else {
          c.strokeStyle = s.color;
          const segs = [];                                        // contiguous runs of points
          let cur = null;
          for (let i = Math.max(0, lo - 1); i <= Math.min(hi + 1, vals.length - 1); i++) {
            const val = vals[i];
            const yy = isN(val) ? this.y(r, val) : null;
            if (yy === null) { cur = null; continue; }
            if (!cur) { cur = []; segs.push(cur); }
            cur.push([this.x(i), yy]);
          }
          let g = null;
          if (s.area) { g = c.createLinearGradient(0, r.top, 0, r.bot); g.addColorStop(0, s.area); g.addColorStop(1, "rgba(0,0,0,0)"); }
          for (const sg of segs) {
            c.beginPath();
            sg.forEach(([xx, yy], k) => {
              if (!k) c.moveTo(xx, yy);
              else if (s.step) { c.lineTo(xx, sg[k - 1][1]); c.lineTo(xx, yy); }
              else c.lineTo(xx, yy);
            });
            c.stroke();
            if (g && sg.length > 1) {                              // area under the line
              c.lineTo(sg[sg.length - 1][0], r.bot); c.lineTo(sg[0][0], r.bot); c.closePath();
              const a = c.globalAlpha; c.globalAlpha = 1; c.fillStyle = g; c.fill(); c.globalAlpha = a;
            }
          }
        }
        c.setLineDash([]); c.globalAlpha = 1;
        return;
      }
      case "band": {
        c.fillStyle = s.color; c.globalAlpha = s.alpha == null ? 0.1 : s.alpha;
        let seg = [];
        const flush = () => {
          if (seg.length > 1) {
            c.beginPath();
            seg.forEach((i, k) => { const yy = this.y(r, s.upper[i]); if (k) c.lineTo(this.x(i), yy); else c.moveTo(this.x(i), yy); });
            for (let k = seg.length - 1; k >= 0; k--) c.lineTo(this.x(seg[k]), this.y(r, s.lower[seg[k]]));
            c.closePath(); c.fill();
          }
          seg = [];
        };
        for (let i = Math.max(0, lo - 1); i <= Math.min(hi + 1, s.upper.length - 1); i++) {
          if (isN(s.upper[i]) && isN(s.lower[i]) && this.y(r, s.upper[i]) !== null && this.y(r, s.lower[i]) !== null) seg.push(i); else flush();
        }
        flush();
        c.globalAlpha = 1;
        return;
      }
      case "hist": {
        const base = this.y(r, s.base || 0);
        const w = Math.max(1, Math.min(14, Math.floor(bw * 0.7)));
        c.globalAlpha = s.alpha == null ? 1 : s.alpha;
        const paths = new Map();
        for (let i = lo; i <= hi; i++) {
          const val = s.values[i];
          if (!isN(val)) continue;
          const yy = this.y(r, val);
          const col = s.colors ? s.colors[i] || s.color : s.color;
          let p = paths.get(col);
          if (!p) { p = new Path2D(); paths.set(col, p); }
          const top = Math.min(yy, base), hh = Math.max(1, Math.abs(yy - base));
          p.rect(Math.round(this.x(i)) - Math.floor(w / 2), top, w, hh);
        }
        for (const [col, p] of paths) { c.fillStyle = col; c.fill(p); }
        c.globalAlpha = 1;
        return;
      }
      case "hline": {
        const yy = this.y(r, s.value);
        if (yy === null) return;
        c.strokeStyle = s.color; c.lineWidth = s.width || 1; c.globalAlpha = s.alpha == null ? 1 : s.alpha;
        c.setLineDash(s.dash || []);
        const y5 = Math.round(yy) + 0.5;
        c.beginPath(); c.moveTo(L.plotL, y5); c.lineTo(L.plotR, y5); c.stroke();
        c.setLineDash([]); c.globalAlpha = 1;
        if (s.text) {                                           // a label box near the scale, like a position line
          c.font = `600 ${P.font}`;
          const tw = c.measureText(s.text).width + 10;
          const x0 = Math.max(L.plotL + 4, L.plotR - tw - 64 - (s.textX || 0));
          c.fillStyle = s.textBg || s.color;
          roundRect(c, x0, y5 - 9, tw, 18, P.radius == null ? 3 : P.radius); c.fill();
          c.fillStyle = s.textFg || "#fff"; c.textAlign = "left"; c.textBaseline = "middle";
          c.fillText(s.text, x0 + 5, y5 + 0.5);
          c.font = P.font;
        }
        return;
      }
      case "vline": {
        const xx = Math.round(this.x(s.i)) + 0.5;
        c.strokeStyle = s.color; c.globalAlpha = s.alpha == null ? 0.8 : s.alpha; c.setLineDash(s.dash || [3, 3]);
        c.beginPath(); c.moveTo(xx, r.top); c.lineTo(xx, r.bot); c.stroke();
        c.setLineDash([]); c.globalAlpha = 1;
        return;
      }
      case "zone": {
        const ya = this.y(r, s.hi), yb = this.y(r, s.lo);
        c.fillStyle = s.color; c.globalAlpha = s.alpha == null ? 0.08 : s.alpha;
        c.fillRect(L.plotL, Math.min(ya, yb), L.plotW, Math.abs(yb - ya));
        c.globalAlpha = 1;
        return;
      }
      case "shade": {
        c.globalAlpha = s.alpha == null ? 0.12 : s.alpha;
        const paths = new Map();
        for (let i = lo; i <= hi; i++) {
          const col = s.values[i];
          if (!col) continue;
          let p = paths.get(col);
          if (!p) { p = new Path2D(); paths.set(col, p); }
          p.rect(this.x(i) - bw / 2, r.top, bw + 0.6, r.h);
        }
        for (const [col, p] of paths) { c.fillStyle = col; c.fill(p); }
        c.globalAlpha = 1;
        return;
      }
      case "segments": {
        const labels = [];                                      // labelled segments (levels): one label per row
        for (const g of s.items) {
          if (Math.max(g.i0, g.i1) < lo - 1 || Math.min(g.i0, g.i1) > hi + 1) continue;
          const y0 = this.y(r, g.p0), y1 = this.y(r, g.p1);
          if (y0 === null || y1 === null) continue;
          c.strokeStyle = g.color; c.lineWidth = g.width || 1; c.globalAlpha = g.alpha == null ? 0.8 : g.alpha;
          c.setLineDash(g.dash || [4, 3]);
          c.beginPath(); c.moveTo(this.x(g.i0), y0); c.lineTo(this.x(g.i1), y1); c.stroke();
          if (g.text && g.textLeft && y0 >= r.top + 8 && y0 <= r.bot - 2) {   // a label at the start, above the line
            c.globalAlpha = g.textAlpha == null ? 0.95 : g.textAlpha; c.fillStyle = g.textColor || g.color;
            c.font = P.fontSmall || P.font; c.textAlign = "left"; c.textBaseline = "bottom";
            c.fillText(g.text, Math.max(L.plotL + 4, this.x(Math.min(g.i0, g.i1)) + 4), y0 - 2);
            c.font = P.font; c.globalAlpha = g.alpha == null ? 0.8 : g.alpha;
          } else if (g.text && y1 >= r.top + 8 && y1 <= r.bot - 2) labels.push({ g, y: y1 });
        }
        c.setLineDash([]); c.lineWidth = 1;
        if (labels.length) {                                    // at the segment's right end, clear of the profile
          c.font = P.fontSmall || P.font; c.textAlign = "right"; c.textBaseline = "bottom";
          const right = L.plotR - 4 - L.plotW * (s.textInset || 0);
          const used = [];
          for (const { g, y } of labels.sort((a, b) => (b.g.prio || 0) - (a.g.prio || 0))) {
            if (used.some((u) => Math.abs(u - y) < 11)) continue;
            used.push(y);
            const xe = Math.min(this.x(Math.max(g.i0, g.i1)), right);
            if (xe < L.plotL + 40) continue;
            c.globalAlpha = g.textAlpha == null ? 0.95 : g.textAlpha;
            c.fillStyle = g.textColor || g.color;
            c.fillText(g.text, xe - 2, y - 2);
          }
          c.font = P.font;
        }
        c.globalAlpha = 1;
        return;
      }
      case "boxes": {                                           // price-time rectangles (value areas, a setup's zones)
        for (const g of s.items) {
          if (Math.max(g.i0, g.i1) < lo - 1 || Math.min(g.i0, g.i1) > hi + 1) continue;
          const y0 = this.y(r, g.p0), y1 = this.y(r, g.p1);
          if (y0 === null || y1 === null) continue;
          const x0 = Math.max(L.plotL, Math.min(this.x(g.i0), this.x(g.i1))), x1 = Math.min(L.plotR, Math.max(this.x(g.i0), this.x(g.i1)));
          if (x1 <= x0) continue;
          c.globalAlpha = g.alpha == null ? 0.1 : g.alpha; c.fillStyle = g.color;
          c.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
          if (g.stroke) {
            c.globalAlpha = g.strokeAlpha == null ? 0.6 : g.strokeAlpha; c.strokeStyle = g.stroke; c.lineWidth = 1;
            c.strokeRect(Math.round(x0) + 0.5, Math.round(Math.min(y0, y1)) + 0.5, Math.round(x1 - x0), Math.round(Math.abs(y1 - y0)));
          }
          if (g.text && Math.abs(y1 - y0) >= 13) {
            c.globalAlpha = 0.9; c.fillStyle = g.textColor || g.color; c.font = P.fontSmall || P.font;
            c.textAlign = "left"; c.textBaseline = "top";
            c.fillText(g.text, x0 + 4, Math.min(y0, y1) + 2);
            c.font = P.font;
          }
        }
        c.globalAlpha = 1;
        return;
      }
      case "profile": {                                         // a volume profile on the right edge of the pane
        const bins = s.bins || [];
        let vmax = 0;
        for (const b of bins) vmax = Math.max(vmax, b[2] || 0);
        if (!(vmax > 0)) return;
        const wmax = L.plotW * (s.frac || 0.16), xr = L.plotR - 1;
        for (const b of bins) {
          const ya = this.y(r, b[1]), yb = this.y(r, b[0]);
          if (ya === null || yb === null || Math.max(ya, yb) < r.top || Math.min(ya, yb) > r.bot) continue;
          const top = Math.min(ya, yb), hh = Math.max(1, Math.abs(yb - ya) - 1);
          const poc = b[2] === vmax;
          c.globalAlpha = poc ? (s.pocAlpha == null ? 0.6 : s.pocAlpha) : (s.alpha == null ? 0.25 : s.alpha);
          c.fillStyle = poc ? s.pocColor || s.color : s.color;
          c.fillRect(xr - wmax * (b[2] / vmax), top, wmax * (b[2] / vmax), hh);
        }
        c.globalAlpha = 1;
        return;
      }
      case "markers": return this.drawMarkers(c, r, s, lo, hi);
      default: return;
    }
  }

  drawCandles(c, r, s, lo, hi) {
    const P = this.P, bw = this.barW();
    const style = s.style || "candles";
    const fn = this.d.closedN;                        // bars from here on are still forming
    if (style === "line" || style === "area") {
      c.lineWidth = 2; c.strokeStyle = s.lineColor || P.line; c.lineJoin = "round";
      c.beginPath();
      let pen = false;
      for (let i = Math.max(0, lo - 1); i <= Math.min(hi + 1, this.N - 1); i++) {
        const yy = this.y(r, s.c[i]);
        if (yy === null) continue;
        if (pen) c.lineTo(this.x(i), yy); else { c.moveTo(this.x(i), yy); pen = true; }
      }
      c.stroke();
      if (style === "area") {
        c.lineTo(this.x(Math.min(hi + 1, this.N - 1)), r.bot); c.lineTo(this.x(Math.max(0, lo - 1)), r.bot); c.closePath();
        const g = c.createLinearGradient(0, r.top, 0, r.bot);
        g.addColorStop(0, P.areaTop || "rgba(41,98,255,0.28)"); g.addColorStop(1, P.areaBot || "rgba(41,98,255,0.02)");
        c.fillStyle = g; c.fill();
      }
      return;
    }
    const cw = Math.max(1, Math.min(18, Math.floor(bw * 0.72) | 1));
    const hollow = style === "hollow";
    // one path per colour (up / down, closed / forming): thousands of bars stay fast
    const groups = new Map();
    const grp = (key) => { let g = groups.get(key); if (!g) { g = { wick: new Path2D(), body: new Path2D(), hollow: new Path2D(), bars: new Path2D() }; groups.set(key, g); } return g; };
    const half = Math.floor(cw / 2);
    for (let i = lo; i <= hi; i++) {
      const o = s.o[i], h = s.h[i], l = s.l[i], cl = s.c[i];
      if (!isN(o) || !isN(cl)) continue;
      const up = cl >= o;
      const g = grp((up ? "u" : "d") + (i >= fn ? "f" : ""));
      const xx = Math.round(this.x(i));
      const yh = this.y(r, h), yl = this.y(r, l), yo = this.y(r, o), yc = this.y(r, cl);
      if (yh === null || yl === null || yo === null || yc === null) continue;
      if (style === "bars") {
        const t = Math.max(2, half);
        g.bars.moveTo(xx + 0.5, yh); g.bars.lineTo(xx + 0.5, yl);
        g.bars.moveTo(xx + 0.5 - t, Math.round(yo) + 0.5); g.bars.lineTo(xx + 0.5, Math.round(yo) + 0.5);
        g.bars.moveTo(xx + 0.5, Math.round(yc) + 0.5); g.bars.lineTo(xx + 0.5 + t, Math.round(yc) + 0.5);
        continue;
      }
      const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
      if (cw <= 2) {                                              // dense: one rectangle from high to low
        g.body.rect(xx - half, Math.round(yh), cw, Math.max(1, Math.round(yl - yh)));
        continue;
      }
      g.wick.moveTo(xx + 0.5, yh); g.wick.lineTo(xx + 0.5, top);
      g.wick.moveTo(xx + 0.5, top + bh); g.wick.lineTo(xx + 0.5, yl);
      if (hollow && up) g.hollow.rect(xx - half + 0.5, Math.round(top) + 0.5, cw - 1, Math.max(1, Math.round(bh) - 1));
      else g.body.rect(xx - half, Math.round(top), cw, Math.max(1, Math.round(bh)));
    }
    for (const [key, g] of groups) {
      const up = key[0] === "u";
      const col = up ? s.up || P.up : s.down || P.down;
      c.globalAlpha = key.endsWith("f") ? (P.formingAlpha || 1) : 1;
      c.lineWidth = style === "bars" && bw > 6 ? 1.5 : 1;
      c.strokeStyle = style === "bars" ? col : up ? s.wickUp || P.wickUp || col : s.wickDown || P.wickDown || col;
      if (style === "bars") { c.stroke(g.bars); continue; }
      c.stroke(g.wick);
      c.fillStyle = col; c.fill(g.body);
      if (P.candleBorder && cw > 3) { c.strokeStyle = up ? P.borderUp || col : P.borderDown || col; c.stroke(g.body); }
      c.strokeStyle = col; c.stroke(g.hollow);
    }
    c.globalAlpha = 1; c.lineWidth = 1;
  }

  drawVolume(c, r, s, lo, hi) {
    const frac = s.frac || 0.2;
    let mx = 0;
    for (let i = lo; i <= hi; i++) if (isN(s.values[i]) && s.values[i] > mx) mx = s.values[i];
    if (!(mx > 0)) return;
    const bw = this.barW();
    const w = Math.max(1, Math.min(18, Math.floor(bw * 0.72) | 1));
    const hMax = (r.h - 4) * frac;
    const base = r.bot - 2;
    const paths = new Map();
    for (let i = lo; i <= hi; i++) {
      const val = s.values[i];
      if (!isN(val) || val <= 0) continue;
      const hh = Math.max(1, (val / mx) * hMax);
      const col = s.colors[i] || s.color;
      let p = paths.get(col);
      if (!p) { p = new Path2D(); paths.set(col, p); }
      p.rect(Math.round(this.x(i)) - Math.floor(w / 2), base - hh, w, hh);
    }
    for (const [col, p] of paths) { c.fillStyle = col; c.fill(p); }
    if (s.ma) {
      c.strokeStyle = s.maColor; c.lineWidth = 1.2; c.beginPath();
      let pen = false;
      for (let i = Math.max(0, lo - 1); i <= Math.min(hi + 1, s.ma.length - 1); i++) {
        const val = s.ma[i];
        if (!isN(val)) { pen = false; continue; }
        const yy = base - (val / mx) * hMax;
        if (pen) c.lineTo(this.x(i), yy); else { c.moveTo(this.x(i), yy); pen = true; }
      }
      c.stroke();
    }
    this._volMax = mx;
  }

  drawMarkers(c, r, s, lo, hi) {
    const P = this.P, bw = this.barW();
    const gap = clamp(bw * 0.6, 4, 9);
    const used = new Map();
    const stackOff = (i, side, add) => { const k = Math.round(i) + ":" + side; const u = used.get(k) || 0; used.set(k, u + add); return u; };
    for (const m of s.items) {
      const fi = m.fi != null ? m.fi : m.i;
      if (fi < lo - 1 || fi > hi + 1) continue;
      const xx = this.x(fi);
      const i = clamp(Math.round(fi), 0, this.N - 1);
      let yy;
      if (m.pos === "at") yy = this.y(r, m.price);
      else if (m.pos === "above") yy = this.y(r, m.price != null ? m.price : this.d.h[i]) - gap - stackOff(i, -1, (m.size || 5) * 2 + 10);
      else yy = this.y(r, m.price != null ? m.price : this.d.l[i]) + gap + stackOff(i, 1, (m.size || 5) * 2 + 10);
      if (yy === null || !Number.isFinite(yy)) continue;
      const sz = m.size || 5;
      c.fillStyle = m.color; c.strokeStyle = m.color; c.globalAlpha = m.alpha == null ? 1 : m.alpha;
      c.beginPath();
      if (m.shape === "up") { c.moveTo(xx, yy); c.lineTo(xx - sz, yy + sz * 1.6); c.lineTo(xx + sz, yy + sz * 1.6); c.closePath(); c.fill(); }
      else if (m.shape === "down") { c.moveTo(xx, yy); c.lineTo(xx - sz, yy - sz * 1.6); c.lineTo(xx + sz, yy - sz * 1.6); c.closePath(); c.fill(); }
      else if (m.shape === "arrowUp" || m.shape === "arrowDown") {
        const d = m.shape === "arrowUp" ? 1 : -1;               // execution arrow, pointing at the price
        c.moveTo(xx, yy); c.lineTo(xx - sz, yy + d * sz); c.lineTo(xx - sz * 0.4, yy + d * sz);
        c.lineTo(xx - sz * 0.4, yy + d * sz * 2.1); c.lineTo(xx + sz * 0.4, yy + d * sz * 2.1); c.lineTo(xx + sz * 0.4, yy + d * sz);
        c.lineTo(xx + sz, yy + d * sz); c.closePath(); c.fill();
      } else if (m.shape === "x") {
        c.lineWidth = 1.6; c.moveTo(xx - sz * 0.7, yy - sz * 0.7); c.lineTo(xx + sz * 0.7, yy + sz * 0.7);
        c.moveTo(xx + sz * 0.7, yy - sz * 0.7); c.lineTo(xx - sz * 0.7, yy + sz * 0.7); c.stroke(); c.lineWidth = 1;
      } else if (m.shape === "diamond") { c.moveTo(xx, yy - sz); c.lineTo(xx + sz, yy); c.lineTo(xx, yy + sz); c.lineTo(xx - sz, yy); c.closePath(); c.fill(); }
      else if (m.shape === "label") {
        c.font = `600 ${P.fontSmall || P.font}`;
        const tw = c.measureText(m.text).width + 8, th = 15;
        const below = m.pos !== "above";
        const top = below ? yy + 4 : yy - 4 - th;
        c.moveTo(xx, yy); c.lineTo(xx - 4, below ? yy + 4 : yy - 4); c.lineTo(xx + 4, below ? yy + 4 : yy - 4); c.closePath(); c.fill();
        roundRect(c, xx - tw / 2, top, tw, th, P.radius == null ? 3 : P.radius); c.fill();
        c.fillStyle = m.textColor || "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(m.text, xx, top + th / 2 + 0.5);
        c.font = P.font;
      } else { c.arc(xx, yy, sz * 0.8, 0, Math.PI * 2); c.fill(); }
      if (m.text && m.shape !== "label" && bw >= 4) {
        c.font = `600 ${P.fontSmall || P.font}`; c.textAlign = "center";
        c.textBaseline = m.pos === "above" ? "bottom" : "top";
        c.fillText(m.text, xx, m.pos === "above" ? yy - sz * 1.7 - 1 : yy + sz * 1.7 + 1);
        c.font = P.font;
      }
      c.globalAlpha = 1;
    }
  }

  // value tags on the price scale: each series' last value, labelled lines, the last price with its countdown
  drawTags(c, r) {
    const P = this.P, L = this.L, p = r.pane;
    const tags = [];
    const fmt = p.id === "price" ? (val) => this.axisLabel(r, val) : p.fmt || ((x) => String(x));
    for (const s of p.series) {
      if (s.hidden) continue;
      if (s.kind === "line" && s.tag) {
        let k = Math.min(this.hi, s.values.length - 1);
        while (k >= this.lo && !isN(s.values[k])) k--;
        if (k >= this.lo) tags.push({ y: this.y(r, s.values[k]), text: fmt(s.values[k]), bg: s.tagColor || s.color, fg: "#fff", prio: 1 });
      } else if (s.kind === "hline" && s.tag !== false && (s.tag || s.text)) {
        const yy = this.y(r, s.value);
        if (yy !== null) tags.push({ y: yy, text: fmt(s.value), bg: s.color, fg: s.tagFg || "#fff", prio: 2 });
      } else if (s.kind === "hist" && s.tag) {
        let k = Math.min(this.hi, s.values.length - 1);
        while (k >= this.lo && !isN(s.values[k])) k--;
        if (k >= this.lo) tags.push({ y: this.y(r, s.values[k]), text: fmt(s.values[k]), bg: (s.colors && s.colors[k]) || s.color, fg: "#fff", prio: 1 });
      }
    }
    if (p.id === "price" && this.d) {
      const i = this.N - 1, cl = this.d.c[i], o = this.d.o[i];
      const up = cl >= o;
      const col = up ? P.up : P.down;
      const yy = this.y(r, cl);
      if (yy !== null && yy >= r.top && yy <= r.bot) {
        c.save(); c.beginPath(); c.rect(L.plotL, r.top, L.plotW, r.h); c.clip();
        c.strokeStyle = col; c.setLineDash(P.lastDash || [1, 2]); c.globalAlpha = 0.9;
        const y5 = Math.round(yy) + 0.5;
        c.beginPath(); c.moveTo(L.plotL, y5); c.lineTo(L.plotR, y5); c.stroke();
        c.restore();
        let cd = null;
        if (this.countdown && this.d.closedN < this.N) {
          const end = this.d.t[i] + this.d.barMs, left = Math.max(0, Math.round((end - Date.now()) / 1000));
          const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
          cd = left >= 86400 ? `${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`
            : hh ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
        }
        tags.push({ y: yy, text: fmt(cl), sub: cd, bg: col, fg: P.lastFg || "#fff", prio: 9 });
      }
    }
    if (!tags.length) return [];
    // keep tags apart: the most important wins its place, others slide out of the way
    tags.sort((a, b) => b.prio - a.prio);
    const placed = [];
    for (const t of tags) {
      const hh = t.sub ? 30 : 17;
      let yy = t.y;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((q) => Math.abs(q.y - yy) < (q.h + hh) / 2);
        if (!hit) break;
        yy = yy >= hit.y ? hit.y + (hit.h + hh) / 2 : hit.y - (hit.h + hh) / 2;
      }
      if (yy < r.top + hh / 2 || yy > r.bot - hh / 2) { if (t.prio < 9) continue; yy = clamp(yy, r.top + hh / 2, r.bot - hh / 2); }
      placed.push({ y: yy, h: hh });
      t.py = yy; t.h = hh;
    }
    for (const t of tags.filter((q) => q.py != null).sort((a, b) => a.prio - b.prio)) {
      c.font = `600 ${P.font}`;
      c.fillStyle = t.bg;
      const x0 = L.plotR + 1, w = this.axisW - 2;
      const top = t.py - t.h / 2;
      roundRect(c, x0, top, w, t.h, P.radius == null ? 2 : P.radius); c.fill();
      c.fillStyle = t.fg; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText(t.text, x0 + 6, t.sub ? top + 8.5 : t.py + 0.5);
      if (t.sub) { c.font = P.font; c.globalAlpha = 0.9; c.fillText(t.sub, x0 + 6, top + 22); c.globalAlpha = 1; }
    }
    c.font = P.font;
    return placed;
  }

  drawHighLow(c, r, lo, hi) {
    const P = this.P, s = this.panes[0].series.find((q) => q.kind === "candles");
    if (!s || !P.hlLabels || hi - lo < 3) return;
    let ih = -1, il = -1;
    const a = Math.max(lo, Math.ceil(this.view.i0)), b = Math.min(hi, Math.floor(this.view.i1));
    for (let i = a; i <= b; i++) {
      if (!isN(s.h[i])) continue;
      if (ih < 0 || s.h[i] > s.h[ih]) ih = i;
      if (il < 0 || s.l[i] < s.l[il]) il = i;
    }
    if (ih < 0) return;
    c.font = P.fontSmall || P.font;
    c.fillStyle = P.hlLabel || P.text; c.strokeStyle = P.hlLabel || P.text; c.globalAlpha = 0.9;
    const mark = (i, val, above) => {
      const xx = this.x(i), yy = this.y(r, val);
      if (yy === null) return;
      const txt = this.pxFmt(val);
      const tw = c.measureText(txt).width;
      const right = xx + 24 + tw < this.L.plotR;
      const x2 = right ? xx + 18 : xx - 18;
      c.beginPath(); c.moveTo(xx + (right ? 3 : -3), yy); c.lineTo(x2, yy); c.stroke();
      c.textAlign = right ? "left" : "right"; c.textBaseline = above ? "bottom" : "top";
      c.textBaseline = "middle";
      c.fillText(txt, x2 + (right ? 3 : -3), yy);
    };
    mark(ih, s.h[ih], true);
    if (il !== ih) mark(il, s.l[il], false);
    c.globalAlpha = 1; c.font = P.font;
    this.hlIdx = { ih, il };
  }

  // Bloomberg-style statistics for the visible range: last, high (with its date), average close, low (with its date)
  drawStats(c, r, lo, hi) {
    const P = this.P, d = this.d;
    const a = Math.max(lo, Math.ceil(this.view.i0)), b = Math.min(hi, Math.floor(this.view.i1));
    if (b - a < 2) return;
    let ih = a, il = a, sum = 0, n = 0;
    for (let i = a; i <= b; i++) { if (d.h[i] > d.h[ih]) ih = i; if (d.l[i] < d.l[il]) il = i; sum += d.c[i]; n++; }
    const rows = [
      ["Last Price", this.pxFmt(d.c[this.N - 1]), P.statLast || P.up],
      [`High on ${this.statDate(d.t[ih])}`, this.pxFmt(d.h[ih]), P.statHigh || P.text],
      ["Average", this.pxFmt(sum / n), P.statAvg || P.text],
      [`Low on ${this.statDate(d.t[il])}`, this.pxFmt(d.l[il]), P.statLow || P.text],
    ];
    c.font = P.fontSmall || P.font;
    const w1 = Math.max(...rows.map((q) => c.measureText(q[0]).width)), w2 = Math.max(...rows.map((q) => c.measureText(q[1]).width));
    const W = w1 + w2 + 34, H = rows.length * 16 + 8;
    const x0 = this.L.plotR - W - 10, y0 = r.top + 8;
    c.fillStyle = P.statBg || "rgba(0,0,0,0.6)"; c.strokeStyle = P.statBorder || P.axisLine;
    c.fillRect(x0, y0, W, H); c.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
    rows.forEach((q, k) => {
      const yy = y0 + 12 + k * 16;
      c.fillStyle = q[2]; c.fillRect(x0 + 7, yy - 4, 8, 8);
      c.fillStyle = P.statKey || P.text; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(q[0], x0 + 20, yy);
      c.fillStyle = P.statVal || P.textStrong || P.text; c.textAlign = "right"; c.fillText(q[1], x0 + W - 7, yy);
    });
    c.font = P.font;
  }
  statDate(t) {
    const d = new Date(t);
    const loc = this.tz !== "utc";
    const day = loc ? d.getDate() : d.getUTCDate(), mon = (loc ? d.getMonth() : d.getUTCMonth()) + 1, yr = (loc ? d.getFullYear() : d.getUTCFullYear()) % 100;
    let s = `${String(mon).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(yr).padStart(2, "0")}`;
    if (this.d.barMs < 86400000) { const hh = loc ? d.getHours() : d.getUTCHours(), mm = loc ? d.getMinutes() : d.getUTCMinutes(); s += ` ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; }
    return s;
  }

  // ------------------------------------------------------------------ time scale
  parts(t) {
    const key = this.tz + t;
    const hit = this._pc && this._pc.get(key);
    if (hit) return hit;
    if (!this._pc || this._pc.size > 30000) this._pc = new Map();
    const p = this._parts(t);
    this._pc.set(key, p);
    return p;
  }
  _parts(t) {
    const d = new Date(t);
    if (this.tz === "utc") return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), wd: d.getUTCDay() };
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), m: d.getMinutes(), wd: d.getDay() };
  }

  timeTicks(lo, hi) {
    const T = this.d.t, bw = this.barW();
    const minGap = 78;
    const cands = [];
    let prev = lo > 0 ? this.parts(T[lo - 1]) : null;
    const MON = this.opts.months || ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = lo; i <= hi; i++) {
      const p = this.parts(T[i]);
      let w = 0, label = "";
      if (!prev || p.y !== prev.y) { w = TIME_W.year; label = String(p.y); }
      else if (p.mo !== prev.mo) { w = TIME_W.month; label = MON[p.mo]; }
      else if (p.d !== prev.d) { w = TIME_W.day; label = String(p.d); }
      else if (p.h !== prev.h) {
        w = p.h % 12 === 0 ? TIME_W.h12 : p.h % 6 === 0 ? TIME_W.h6 : p.h % 4 === 0 ? TIME_W.h4 : p.h % 3 === 0 ? TIME_W.h3 : TIME_W.h1;
        label = `${String(p.h).padStart(2, "0")}:00`;
      } else if (p.m !== prev.m) {
        w = p.m % 30 === 0 ? TIME_W.m30 : p.m % 15 === 0 ? TIME_W.m15 : p.m % 5 === 0 ? TIME_W.m5 : TIME_W.m1;
        label = `${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}`;
      }
      if (!prev && i === lo) { w = 0; }                       // the first visible bar is not a boundary
      prev = p;
      if (w) cands.push({ i, w, label });
    }
    cands.sort((a, b) => b.w - a.w || a.i - b.i);
    const acc = [];
    for (const cnd of cands) {
      if (acc.some((q) => Math.abs(q.i - cnd.i) * bw < minGap)) continue;
      acc.push(cnd);
    }
    // weeks on daily bars: if days are dense, keep Mondays only through spacing; fine as is
    return acc.sort((a, b) => a.i - b.i);
  }

  // ------------------------------------------------------------------ crosshair
  drawCrosshair(c) {
    const h = this.hover, P = this.P, L = this.L;
    if (!h || h.out) return;
    const xx = Math.round(this.x(h.i)) + 0.5;
    c.strokeStyle = P.cross; c.lineWidth = 1; c.setLineDash(P.crossDash || [5, 4]);
    c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, L.timeTop); c.stroke();
    const r = this.paneAt(h.y);
    let yv = h.y;
    if (r && this.magnet && r.id === "price") {
      const i = clamp(h.i, 0, this.N - 1);
      const cand = [this.d.o[i], this.d.h[i], this.d.l[i], this.d.c[i]].map((p) => this.y(r, p));
      yv = cand.reduce((a, b) => (Math.abs(b - h.y) < Math.abs(a - h.y) ? b : a), cand[0]);
    }
    if (r) { c.beginPath(); c.moveTo(L.plotL, Math.round(yv) + 0.5); c.lineTo(L.plotR, Math.round(yv) + 0.5); c.stroke(); }
    c.setLineDash([]);
    // labels
    c.font = `600 ${P.font}`;
    if (r) {
      const val = r.id === "price" ? this.valAt(r, yv) : this.valAt(r, yv);
      const txt = r.id === "price" ? this.axisLabel(r, val) : (r.pane.fmt || String)(val);
      c.fillStyle = P.crossBg; roundRect(c, L.plotR + 1, yv - 9, this.axisW - 2, 18, P.radius == null ? 2 : P.radius); c.fill();
      c.fillStyle = P.crossFg; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(txt, L.plotR + 7, yv + 0.5);
    }
    const t = h.i < this.N ? this.d.t[clamp(h.i, 0, this.N - 1)] : this.timeAt(h.i);
    const s = this.timeFmt(t, this.d.barMs, this.tz);
    const tw = c.measureText(s).width + 14;
    const bx = clamp(xx - tw / 2, L.plotL, L.plotR - tw);
    c.fillStyle = P.crossBg; roundRect(c, bx, L.timeTop + 3, tw, 20, P.radius == null ? 2 : P.radius); c.fill();
    c.fillStyle = P.crossFg; c.textAlign = "center"; c.fillText(s, bx + tw / 2, L.timeTop + 13.5);
    c.font = P.font;
  }

  // ------------------------------------------------------------------ drawings
  pt(r, d) { return { x: this.x(this.fIndex(d.t)), y: this.y(r, d.v) }; }

  drawDrawings(c, r) {
    const P = this.P;
    const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
    for (const g of all) {
      if (!g.p1) continue;
      const col = g.color || P.draw;
      const sel = this.selected === g.id || g === this.draft;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = sel ? 2 : 1.5;
      const a = this.pt(r, g.p1), b = g.p2 ? this.pt(r, g.p2) : a;
      if (a.y === null || b.y === null) continue;
      if (g.type === "trend" || g.type === "ray") {
        let bx = b.x, by = b.y;
        if (g.type === "ray" && (b.x !== a.x || b.y !== a.y)) {
          const k = 4000 / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          bx = a.x + (b.x - a.x) * k; by = a.y + (b.y - a.y) * k;
        }
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(bx, by); c.stroke();
      } else if (g.type === "hline") {
        const yy = Math.round(a.y) + 0.5;
        c.beginPath(); c.moveTo(this.L.plotL, yy); c.lineTo(this.L.plotR, yy); c.stroke();
      } else if (g.type === "vline") {
        const xx = Math.round(a.x) + 0.5;
        c.beginPath(); c.moveTo(xx, r.top); c.lineTo(xx, r.bot); c.stroke();
      } else if (g.type === "rect") {
        c.globalAlpha = 0.12; c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        c.globalAlpha = 1; c.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else if (g.type === "fib") {
        const x0 = Math.min(a.x, b.x), x1 = Math.max(this.L.plotR, Math.max(a.x, b.x));
        c.font = P.fontSmall || P.font;
        FIB.forEach((f, k) => {
          const val = g.p2.v + (g.p1.v - g.p2.v) * f;
          const yy = Math.round(this.y(r, val)) + 0.5;
          c.strokeStyle = P.fib ? P.fib[k % P.fib.length] : col; c.globalAlpha = 0.9;
          c.beginPath(); c.moveTo(x0, yy); c.lineTo(x1, yy); c.stroke();
          if (k < FIB.length - 1) {
            const y2 = this.y(r, g.p2.v + (g.p1.v - g.p2.v) * FIB[k + 1]);
            c.globalAlpha = 0.06; c.fillStyle = c.strokeStyle; c.fillRect(x0, Math.min(yy, y2), x1 - x0, Math.abs(y2 - yy));
          }
          c.globalAlpha = 1; c.fillStyle = c.strokeStyle; c.textAlign = "left"; c.textBaseline = "bottom";
          c.fillText(`${f} (${this.pxFmt(val)})`, x0 + 4, yy - 2);
        });
        c.strokeStyle = col; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
        c.font = P.font;
      } else if (g.type === "measure") {
        this.drawMeasure(c, r, g, a, b);
      }
      if (sel && g.type !== "measure") {
        c.fillStyle = P.bg; c.strokeStyle = col; c.lineWidth = 1.5;
        for (const q of g.type === "hline" || g.type === "vline" ? [a] : [a, b]) { c.beginPath(); c.arc(q.x, q.y, 4.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
      }
      c.lineWidth = 1;
    }
    if (this.measure) {
      const a = this.pt(r, this.measure.p1), b = this.pt(r, this.measure.p2);
      if (a.y !== null && b.y !== null) this.drawMeasure(c, r, this.measure, a, b);
    }
  }

  drawMeasure(c, r, g, a, b) {
    const P = this.P;
    const up = g.p2.v >= g.p1.v;
    const col = up ? P.measureUp || P.up : P.measureDown || P.down;
    c.globalAlpha = 0.16; c.fillStyle = col;
    c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    c.globalAlpha = 1; c.strokeStyle = col;
    c.beginPath(); c.moveTo((a.x + b.x) / 2, a.y); c.lineTo((a.x + b.x) / 2, b.y); c.moveTo(a.x, (a.y + b.y) / 2); c.lineTo(b.x, (a.y + b.y) / 2); c.stroke();
    const dv = g.p2.v - g.p1.v, pc = g.p1.v ? (dv / g.p1.v) * 100 : 0;
    const bars = Math.round(this.fIndex(g.p2.t) - this.fIndex(g.p1.t));
    const secs = Math.abs(g.p2.t - g.p1.t) / 1000;
    const dur = secs >= 86400 ? `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h` : secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : `${Math.round(secs / 60)}m`;
    const l1 = `${dv >= 0 ? "+" : "−"}${this.pxFmt(Math.abs(dv))} (${pc >= 0 ? "+" : "−"}${Math.abs(pc).toFixed(2)}%)`;
    const l2 = `${bars} bars, ${dur}`;
    c.font = `600 ${P.font}`;
    const tw = Math.max(c.measureText(l1).width, c.measureText(l2).width) + 16;
    const bx = (a.x + b.x) / 2 - tw / 2, by = up ? Math.min(a.y, b.y) - 44 : Math.max(a.y, b.y) + 6;
    c.fillStyle = col; roundRect(c, bx, by, tw, 38, P.radius == null ? 3 : P.radius); c.fill();
    c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(l1, bx + tw / 2, by + 12); c.font = P.font; c.fillText(l2, bx + tw / 2, by + 27);
  }

  hitDrawing(x, y) {
    const r = this.L && this.L.panes[0];
    if (!r || this.hideDrawings) return null;
    let best = null, bd = 7;
    for (const g of this.drawings) {
      const a = this.pt(r, g.p1), b = g.p2 ? this.pt(r, g.p2) : a;
      if (a.y === null || b.y === null) continue;
      let d = Infinity, part = "body";
      const da = Math.hypot(x - a.x, y - a.y), db = Math.hypot(x - b.x, y - b.y);
      if (g.type !== "hline" && g.type !== "vline") { if (da < 7) { d = da; part = "p1"; } else if (db < 7) { d = db; part = "p2"; } }
      if (d === Infinity) {
        if (g.type === "trend") d = distSeg(x, y, a.x, a.y, b.x, b.y);
        else if (g.type === "ray") d = distSeg(x, y, a.x, a.y, b.x, b.y, true);
        else if (g.type === "hline") d = Math.abs(y - a.y);
        else if (g.type === "vline") d = Math.abs(x - a.x);
        else if (g.type === "rect" || g.type === "fib") {
          const x0 = Math.min(a.x, b.x), x1 = g.type === "fib" ? this.L.plotR : Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
          const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
          d = inside ? (g.type === "rect" ? Math.min(x - x0, x1 - x, y - y0, y1 - y) : 0) : Infinity;
          if (g.type === "rect" && inside) d = Math.min(d, 6);
        }
      }
      if (d < bd) { bd = d; best = { g, part }; }
    }
    return best;
  }

  setTool(t) {
    this.tool = t;
    this.draft = null;
    this.canvas.style.cursor = t === "cursor" ? "" : "crosshair";
    this.redraw();
  }

  snapPoint(r, x, y) {
    let fi = this.idxAt(x);
    const i = Math.round(fi);
    fi = i;
    let v = this.valAt(r, y);
    if (this.magnet && i >= 0 && i < this.N) {
      const cand = [this.d.o[i], this.d.h[i], this.d.l[i], this.d.c[i]];
      const best = cand.reduce((a, b) => (Math.abs(this.y(r, b) - y) < Math.abs(this.y(r, a) - y) ? b : a), cand[0]);
      if (Math.abs(this.y(r, best) - y) < 24) v = best;
    }
    return { t: Math.round(this.timeAt(fi)), v };
  }

  // ------------------------------------------------------------------ legends
  placeLegends() {
    if (!this.L) return;
    for (const r of this.L.panes) {
      const el = this.legends.get(r.id);
      if (!el) continue;
      el.style.top = (r.top + 4) + "px";
      el.style.maxWidth = Math.max(120, this.L.plotW - (r.id === "price" && this.showStats ? 230 : 20)) + "px";
      el.style.maxHeight = Math.max(18, r.h - 8) + "px";
    }
  }

  // ------------------------------------------------------------------ input
  _bind() {
    const cv = this.canvas;
    const local = (ev) => { const b = cv.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
    let drag = null;
    cv.addEventListener("pointerdown", (ev) => {
      if (!this.view || !this.L || ev.button > 0) return;
      cv.focus({ preventScroll: true });
      const [x, y] = local(ev);
      const L = this.L;
      const r = this.paneAt(y);
      cv.setPointerCapture(ev.pointerId);
      if (this.measure && this.tool !== "measure") { this.measure = null; this.redraw(); }
      // separator between panes
      const sep = L.panes.slice(1).find((q) => Math.abs(y - q.top) <= SEP_HIT);
      if (sep && x < L.plotR) {
        const k = L.panes.indexOf(sep);
        drag = { kind: "sep", k, y, a: L.panes[k - 1].h, b: sep.h };
        return;
      }
      if (x >= L.plotR && r) {                                     // price scale: stretch it
        drag = { kind: "yscale", r, y, y0: r.y0, y1: r.y1 };
        return;
      }
      if (y >= L.timeTop) { drag = { kind: "xscale", x, view: { ...this.view } }; return; }
      if (this.tool !== "cursor" && r && r.id === "price") {
        const p = this.snapPoint(r, x, y);
        if (this.tool === "measure") { this.measure = { type: "measure", p1: p, p2: { ...p } }; drag = { kind: "measure", r, x, y }; return; }
        if (ONE_POINT.has(this.tool)) {
          const g = { id: newId(), type: this.tool, p1: p };
          this.drawings.push(g); this.selected = g.id;
          this.emit("drawings", this.drawings); this.emit("tooldone");
          this.redraw();
          return;
        }
        if (this.draft) {                                         // second click of a click-click placement
          this.draft.p2 = p;
          this.finishDraft();
          return;
        }
        this.draft = { id: newId(), type: this.tool, p1: p, p2: { ...p } };
        drag = { kind: "create", r, x, y };
        this.redraw();
        return;
      }
      const hit = r && r.id === "price" ? this.hitDrawing(x, y) : null;
      if (hit) {
        this.selected = hit.g.id;
        drag = { kind: "edit", g: hit.g, part: hit.part, r, start: this.snapPoint(r, x, y), p1: { ...hit.g.p1 }, p2: hit.g.p2 ? { ...hit.g.p2 } : null, moved: false };
        this.emit("select", hit.g);
        this.redraw();
        return;
      }
      if (this.selected) { this.selected = null; this.emit("select", null); }
      drag = { kind: "pan", x, y, view: { ...this.view }, r, man: r && r.pane.manual ? { ...r.pane.manual } : null, moved: false };
    });
    cv.addEventListener("pointermove", (ev) => {
      const [x, y] = local(ev);
      if (!this.view || !this.L) return;
      const L = this.L;
      if (drag) {
        if (drag.kind === "pan") {
          const dx = x - drag.x, dy = y - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
          const shift = dx / this.barW();
          this.setView(drag.view.i0 - shift, drag.view.i1 - shift, false);
          if (drag.man && drag.r) {                               // a stretched scale also pans vertically
            const per = (drag.man.y1 - drag.man.y0) / Math.max(1, drag.r.h - drag.r.padT - drag.r.padB);
            drag.r.pane.manual = { y0: drag.man.y0 + dy * per, y1: drag.man.y1 + dy * per };
          }
          cv.style.cursor = "grabbing";
          this.emit("view", this.view);
        } else if (drag.kind === "yscale") {
          const f = Math.exp((y - drag.y) * 0.006);
          const mid = (drag.y0 + drag.y1) / 2, half = ((drag.y1 - drag.y0) / 2) * f;
          drag.r.pane.manual = { y0: mid - half, y1: mid + half };
        } else if (drag.kind === "xscale") {
          const f = Math.exp(-(x - drag.x) * 0.006);
          const v = drag.view, span = v.i1 - v.i0, ns = span * f;
          this.setView(v.i1 - ns, v.i1, false);
          this.emit("view", this.view);
        } else if (drag.kind === "sep") {
          const dy = y - drag.y;
          const a = Math.max(MIN_PANE, drag.a + dy), b = Math.max(MIN_PANE, drag.b - dy);
          const pa = this.panes[drag.k - 1], pb = this.panes[drag.k];
          const tot = (pa.weight || 1) + (pb.weight || 1);
          pa.weight = (tot * a) / (a + b); pb.weight = (tot * b) / (a + b);
          this.emit("panes", this.panes);
        } else if (drag.kind === "create" && this.draft) {
          this.draft.p2 = this.snapPoint(drag.r, x, y);
          if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
        } else if (drag.kind === "measure" && this.measure) {
          this.measure.p2 = this.snapPoint(drag.r, x, y);
        } else if (drag.kind === "edit") {
          const p = this.snapPoint(drag.r, x, y);
          const g = drag.g;
          drag.moved = true;
          if (drag.part === "p1") g.p1 = p;
          else if (drag.part === "p2") g.p2 = p;
          else {
            const dt = p.t - drag.start.t, dv = p.v - drag.start.v;
            g.p1 = { t: drag.p1.t + dt, v: drag.p1.v + dv };
            if (drag.p2) g.p2 = { t: drag.p2.t + dt, v: drag.p2.v + dv };
          }
        }
      } else {
        // cursor shape
        const nearSep = L.panes.slice(1).some((q) => Math.abs(y - q.top) <= SEP_HIT) && x < L.plotR;
        cv.style.cursor = nearSep ? "row-resize" : x >= L.plotR ? "ns-resize" : y >= L.timeTop ? "ew-resize"
          : this.tool !== "cursor" ? "crosshair" : (this.paneAt(y) && this.paneAt(y).id === "price" && this.hitDrawing(x, y)) ? "pointer" : "crosshair";
      }
      const inPlot = x < L.plotR && y < L.timeTop;
      this.hover = inPlot ? { x, y, i: Math.round(this.idxAt(x)), out: false } : null;
      if (drag) this.redraw(); else this.redrawOverlay();
      this.emit("hover", this.hover ? clamp(this.hover.i, 0, this.N - 1) : null, this.hover && this.paneAt(y));
    });
    const end = (ev) => {
      if (drag && drag.kind === "create" && this.draft && drag.moved) this.finishDraft();
      else if (drag && drag.kind === "edit" && drag.moved) this.emit("drawings", this.drawings);
      else if (drag && drag.kind === "measure" && this.measure) { this.emit("tooldone"); }
      else if (drag && drag.kind === "sep") this.emit("panesDone", this.panes);
      else if (drag && drag.kind === "pan" && !drag.moved) this.emit("click", this.hover);
      drag = null;
      cv.style.cursor = this.tool === "cursor" ? "" : "crosshair";
      this.redraw();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (!drag) { this.hover = null; this.redrawOverlay(); this.emit("hover", null, null); } });
    cv.addEventListener("wheel", (ev) => {
      if (!this.view || !this.L) return;
      ev.preventDefault();
      const [x, y] = local(ev);
      const r = this.paneAt(y);
      if (x >= this.L.plotR && r) {                               // over a price scale: stretch it
        const base = r.pane.manual || { y0: r.y0, y1: r.y1 };
        const f = Math.exp(ev.deltaY * 0.002), mid = (base.y0 + base.y1) / 2, half = ((base.y1 - base.y0) / 2) * f;
        r.pane.manual = { y0: mid - half, y1: mid + half };
        this.redraw();
        return;
      }
      if (!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { this.pan(ev.deltaX / this.barW()); return; }
      if (ev.shiftKey) { this.pan((ev.deltaY / this.barW()) * 0.5); return; }
      const k = ev.ctrlKey ? 0.01 : 0.0018;
      this.zoom(Math.exp(ev.deltaY * k), Math.min(x, this.L.plotR));
    }, { passive: false });
    cv.addEventListener("dblclick", (ev) => {
      if (!this.L) return;
      const [x, y] = local(ev);
      const r = this.paneAt(y);
      if (x >= this.L.plotR && r) { r.pane.manual = null; this.redraw(); return; }
      if (y >= this.L.timeTop) { this.reset(); return; }
      const hit = r && r.id === "price" ? this.hitDrawing(x, y) : null;
      if (hit) { this.emit("editDrawing", hit.g); return; }
      this.reset();
    });
    cv.addEventListener("keydown", (ev) => this.key(ev));
    cv.addEventListener("contextmenu", (ev) => {
      if (this.tool !== "cursor" || this.draft) { ev.preventDefault(); this.draft = null; this.emit("tooldone"); this.redraw(); }
    });
  }

  finishDraft() {
    const g = this.draft;
    this.draft = null;
    if (g && (g.p1.t !== g.p2.t || g.p1.v !== g.p2.v)) {
      this.drawings.push(g);
      this.selected = g.id;
      this.emit("drawings", this.drawings);
    }
    this.emit("tooldone");
    this.redraw();
  }

  deleteSelected() {
    if (!this.selected) return false;
    const n = this.drawings.length;
    this.drawings = this.drawings.filter((g) => g.id !== this.selected);
    this.selected = null;
    if (this.drawings.length !== n) { this.emit("drawings", this.drawings); this.redraw(); return true; }
    return false;
  }

  key(ev) {
    if (!this.view) return;
    const span = this.view.i1 - this.view.i0;
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const s = (ev.key === "ArrowLeft" ? -1 : 1) * (ev.shiftKey ? Math.max(1, span * 0.25) : mod ? span * 0.9 : 1);
      this.pan(s);
    } else if ((ev.key === "ArrowUp" && mod) || ev.key === "+" || ev.key === "=") this.zoom(0.8);
    else if ((ev.key === "ArrowDown" && mod) || ev.key === "-" || ev.key === "_") this.zoom(1.25);
    else if (ev.key === "Home") this.setView(-this.rightBars, span - this.rightBars);
    else if (ev.key === "End") this.reset();
    else if (ev.key === "Escape") { this.draft = null; this.measure = null; if (this.tool !== "cursor") this.emit("tooldone"); this.selected = null; this.redraw(); }
    else if ((ev.key === "Delete" || ev.key === "Backspace") && this.selected) this.deleteSelected();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  snapshot(title) {
    const dpr = window.devicePixelRatio || 1;
    const out = document.createElement("canvas");
    const head = 30;
    out.width = this.canvas.width; out.height = this.canvas.height + head * dpr;
    const c = out.getContext("2d");
    c.fillStyle = this.P.bg; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(this.canvas, 0, head * dpr);
    c.scale(dpr, dpr);
    c.fillStyle = this.P.textStrong || this.P.text; c.font = `600 13px ${this.P.family || "sans-serif"}`;
    c.textBaseline = "middle"; c.textAlign = "left";
    c.fillText(title || "", 10, head / 2);
    return out.toDataURL("image/png");
  }
}
