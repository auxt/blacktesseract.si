/* The chart's indicators: HyperLight's studies (Project HyperTrader, web/js/charttab.js, 14 Nov 2026), ported to
   TesseractCharts' windows. HyperLight is not changed. The maths is HyperLight's ta.js (copied beside this file);
   the definitions, defaults and descriptions are HyperLight's. Its own studies that need HyperLight's server (its
   agents, trades, range map, NW envelope, Lorentzian signals) stay in HyperLight; open interest and funding come from
   TesseractAlpha's recorder through /api/perp. */
import * as TA from "./ta.js";

const isN = (x) => x !== null && x !== undefined && Number.isFinite(x);

// pane "price" draws over the candles; "own" gets a pane of its own; needs: the data it reads besides the candles
export const IND = {
  vol: { name: "Volume", cat: "Volume", pane: "price", desc: "Traded volume per bar with its 20-bar average, at the foot of the price pane: moves on rising volume are the ones that tend to hold.",
    params: [{ k: "ma", label: "Average length", type: "int", def: 20, min: 0, max: 500 }] },
  ma: { name: "Moving averages", cat: "Trend", pane: "price", desc: "Three moving averages (20, 50, 200). Price above a rising average is the timing rule with the best record in crypto studies (Detzel et al.), before costs.",
    params: [{ k: "type", label: "Type", type: "select", options: ["EMA", "SMA", "WMA"], def: "EMA" }, { k: "l1", label: "Fast", type: "int", def: 20, min: 0, max: 1000 },
      { k: "l2", label: "Medium", type: "int", def: 50, min: 0, max: 1000 }, { k: "l3", label: "Slow", type: "int", def: 200, min: 0, max: 1000 }] },
  vwap: { name: "VWAP", cat: "Volume", pane: "price", desc: "Volume-weighted average price, restarted each day (or week, month on longer bars), with ±1σ / ±2σ bands: the benchmark fills are judged against.",
    params: [{ k: "anchor", label: "Anchor", type: "select", options: ["Auto", "Day", "Week", "Month"], def: "Auto" }, { k: "b1", label: "Band 1 (σ)", type: "float", def: 1, min: 0, max: 5, step: 0.5 },
      { k: "b2", label: "Band 2 (σ)", type: "float", def: 2, min: 0, max: 5, step: 0.5 }] },
  bb: { name: "Bollinger Bands", cat: "Volatility", pane: "price", desc: "20-bar average ± 2 standard deviations: a squeeze (narrow bands) often comes before a large move.",
    params: [{ k: "n", label: "Length", type: "int", def: 20, min: 2, max: 500 }, { k: "k", label: "Deviations", type: "float", def: 2, min: 0.5, max: 5, step: 0.5 }] },
  st: { name: "Supertrend", cat: "Trend", pane: "price", desc: "A trailing line 3 ATRs from the median price that flips with the trend: a stop that only tightens.",
    params: [{ k: "n", label: "ATR length", type: "int", def: 10, min: 2, max: 200 }, { k: "m", label: "Multiplier", type: "float", def: 3, min: 0.5, max: 10, step: 0.5 }] },
  dc: { name: "Donchian channel", cat: "Trend", pane: "price", desc: "Highest high and lowest low of the last 20 bars: the channel breakout rule of trend followers.",
    params: [{ k: "n", label: "Length", type: "int", def: 20, min: 2, max: 500 }] },
  lvl: { name: "Key levels", cat: "Trend", pane: "price", desc: "The previous day's high, low and close (previous week's on daily bars and longer).", params: [] },
  rsi: { name: "RSI", cat: "Momentum", pane: "own", desc: "Relative strength index (14, Wilder): above 70 overbought, below 30 oversold; divergences from price flag tired moves.",
    params: [{ k: "n", label: "Length", type: "int", def: 14, min: 2, max: 200 }, { k: "ma", label: "Signal average", type: "int", def: 0, min: 0, max: 100 }] },
  macd: { name: "MACD", cat: "Momentum", pane: "own", desc: "12/26 EMA difference with its 9-bar signal line and histogram.",
    params: [{ k: "f", label: "Fast", type: "int", def: 12, min: 1, max: 200 }, { k: "s", label: "Slow", type: "int", def: 26, min: 2, max: 400 }, { k: "g", label: "Signal", type: "int", def: 9, min: 1, max: 100 }] },
  stoch: { name: "Stochastic", cat: "Momentum", pane: "own", desc: "Where the close sits in the 14-bar range, %K and %D: above 80 / below 20 stretched.",
    params: [{ k: "k", label: "%K length", type: "int", def: 14, min: 1, max: 200 }, { k: "ks", label: "%K smoothing", type: "int", def: 3, min: 1, max: 50 }, { k: "d", label: "%D smoothing", type: "int", def: 3, min: 1, max: 50 }] },
  atr: { name: "ATR", cat: "Volatility", pane: "own", desc: "Average true range (14, Wilder), also as a percentage of price: sizes stops in the market's own units.",
    params: [{ k: "n", label: "Length", type: "int", def: 14, min: 1, max: 200 }] },
  adx: { name: "ADX / DMI", cat: "Trend", pane: "own", desc: "Trend strength (ADX above 25: trending) with the +DI / −DI direction lines.",
    params: [{ k: "n", label: "DI length", type: "int", def: 14, min: 2, max: 200 }, { k: "s", label: "ADX smoothing", type: "int", def: 14, min: 1, max: 200 }] },
  obv: { name: "On-balance volume", cat: "Volume", pane: "own", desc: "Running volume, added on up closes and subtracted on down closes: a crude buying / selling pressure line.", params: [] },
  oi: { name: "Open interest", cat: "Perps", pane: "own", needs: "perp", desc: "Open positions in dollars. Rising open interest with price: new money behind the move; falling: positions closing. Recorded by TesseractAlpha every minute or five (the venues keep no history).", params: [] },
  funding: { name: "Funding rate", cat: "Perps", pane: "own", needs: "perp", desc: "Hourly funding as an annual rate. Persistently high positive funding: crowded longs paying to stay in (a contrarian warning); negative: crowded shorts.", params: [] },
};
export const IND_ORDER = ["vol", "ma", "vwap", "bb", "st", "dc", "lvl", "rsi", "macd", "stoch", "atr", "adx", "obv", "oi", "funding"];
export const CATS = ["All", "On", "Trend", "Momentum", "Volatility", "Volume", "Perps"];
export const TYPES = [["candles", "Candles"], ["hollow", "Hollow candles"], ["ha", "Heikin Ashi"], ["bars", "Bars (OHLC)"], ["line", "Line"], ["area", "Area"]];
export const SCALES = [["normal", "Auto"], ["log", "Log"], ["pct", "%"]];
export const TOOLS = [["cursor", "Crosshair", "Esc"], ["trend", "Trend line"], ["ray", "Ray"], ["hline", "Horizontal line"], ["vline", "Vertical line"], ["rect", "Rectangle"], ["fib", "Fib retracement"], ["measure", "Measure"]];
export const defaults = (k) => Object.fromEntries(IND[k].params.map((q) => [q.k, q.def]));
export const startSet = () => [{ id: "vol", on: true, p: defaults("vol") }, { id: "ma", on: true, p: defaults("ma") }];

const compact = (x, dp = 2) => { if (!isN(x)) return "—"; const a = Math.abs(x), s = x < 0 ? "−" : ""; return s + (a >= 1e9 ? (a / 1e9).toFixed(dp) + "B" : a >= 1e6 ? (a / 1e6).toFixed(dp) + "M" : a >= 1e3 ? (a / 1e3).toFixed(dp) + "K" : a.toFixed(0)); };
const usd = (x) => (isN(x) ? (x < 0 ? "−$" : "$") + compact(Math.abs(x), 2) : "—");

function vwapAnchor(p, barMs) {
  if (p.anchor === "Day") return "D";
  if (p.anchor === "Week") return "W";
  if (p.anchor === "Month") return "M";
  return barMs < 3600e3 ? "D" : barMs < 86400e3 ? "W" : "M";
}

/* One study's series for chartpro (HyperLight's computeInd, without the studies that need HyperLight's server).
   cx: {fpx(v, dp), dp, rgba(c, a), perp: {oi, fund, now} | null, since(t)} */
export function compute(id, p, A, P, cx) {
  const S = P.series, dp = cx.dp;
  const f2 = (x) => cx.fpx(x, dp);
  const ln = (values, color, name, extra = {}) => ({ kind: "line", values, color, width: 1.5, tag: true, lv: true, name, fmt: f2, ...extra });
  switch (id) {
    case "vol": {
      const colors = A.c.map((x, i) => (x >= A.o[i] ? P.volUp : P.volDown));
      const ma = p.ma > 0 ? TA.sma(A.v, p.ma) : null;
      return { title: "Vol", series: [{ kind: "volume", values: A.v, colors, ma, maColor: S[0], frac: 0.2, lv: true, name: "Vol", fmt: (x) => compact(x, 2),
        legendVals: [{ arr: A.v, fmt: (x) => compact(x, 2), color: null }, ...(ma ? [{ arr: ma, fmt: (x) => compact(x, 2), color: S[0], label: `MA ${p.ma}` }] : [])] }] };
    }
    case "ma": {
      const fn = p.type === "SMA" ? TA.sma : p.type === "WMA" ? TA.wma : TA.ema;
      const ls = [p.l1, p.l2, p.l3].filter((x) => x > 0);
      return { title: `${p.type} ${ls.join(" ")}`, series: ls.map((n, k) => ln(fn(A.c, n), S[k], `${p.type} ${n}`, { width: k === 2 ? 2 : 1.5 })) };
    }
    case "vwap": {
      const an = vwapAnchor(p, A.barMs);
      const mults = [p.b1, p.b2].filter((x) => x > 0);
      const r = TA.vwap(A.t, A.h, A.l, A.c, A.v, an, mults);
      const col = S[3];
      const out = [ln(r.mid, col, "VWAP", { width: 1.6 })];
      r.bands.forEach((b, k) => {
        out.push({ kind: "band", upper: b.upper, lower: b.lower, color: col, alpha: k ? 0.025 : 0.045 });
        out.push(ln(b.upper, col, `+${mults[k]}σ`, { width: 1, alpha: 0.6, tag: false, lv: false, dash: [4, 3] }));
        out.push(ln(b.lower, col, `−${mults[k]}σ`, { width: 1, alpha: 0.6, tag: false, lv: false, dash: [4, 3] }));
      });
      return { title: `VWAP ${{ D: "day", W: "week", M: "month" }[an]}`, series: out };
    }
    case "bb": {
      const b = TA.bollinger(A.c, p.n, p.k);
      const col = S[1];
      return { title: `BB ${p.n} ${p.k}`, series: [{ kind: "band", upper: b.upper, lower: b.lower, color: col, alpha: 0.06 },
        ln(b.mid, col, "Basis", { width: 1, alpha: 0.85 }), ln(b.upper, col, "Upper", { width: 1, tag: false }), ln(b.lower, col, "Lower", { width: 1, tag: false })] };
    }
    case "st": {
      const r = TA.supertrend(A.h, A.l, A.c, p.n, p.m);
      const colors = r.dir.map((d) => (d === 1 ? P.up : d === -1 ? P.down : null));
      for (let i = 1; i < colors.length; i++) if (r.dir[i] !== r.dir[i - 1]) colors[i] = null;    // no line across a flip
      return { title: `Supertrend ${p.n} ${p.m}`, series: [ln(r.line, P.up, "Supertrend", { colors, width: 1.8, tagColor: P.text })] };
    }
    case "dc": {
      const r = TA.donchian(A.h, A.l, p.n);
      const col = S[4];
      return { title: `Donchian ${p.n}`, series: [{ kind: "band", upper: r.upper, lower: r.lower, color: col, alpha: 0.04 },
        ln(r.upper, col, "Upper", { width: 1, step: true }), ln(r.lower, col, "Lower", { width: 1, step: true }), ln(r.mid, col, "Basis", { width: 1, alpha: 0.6, dash: [4, 3], tag: false })] };
    }
    case "lvl": {
      const an = A.barMs >= 86400e3 ? "W" : "D";
      const r = TA.prevLevels(A.t, A.h, A.l, A.c, an);
      return { title: `Previous ${an === "W" ? "week" : "day"}`, series: [
        ln(r.high, P.up, `P${an}H`, { width: 1, step: true, dash: [6, 4], alpha: 0.85 }),
        ln(r.low, P.down, `P${an}L`, { width: 1, step: true, dash: [6, 4], alpha: 0.85 }),
        ln(r.close, P.text, `P${an}C`, { width: 1, step: true, dash: [2, 3], alpha: 0.7 })] };
    }
    case "rsi": {
      const r = TA.rsi(A.c, p.n);
      const out = [{ kind: "zone", lo: 30, hi: 70, color: S[2], alpha: 0.06 },
        { kind: "hline", value: 70, color: P.text, dash: [4, 4], alpha: 0.5, tag: false }, { kind: "hline", value: 50, color: P.text, dash: [2, 4], alpha: 0.3, tag: false },
        { kind: "hline", value: 30, color: P.text, dash: [4, 4], alpha: 0.5, tag: false }, ln(r, S[2], "RSI", { fmt: (x) => x.toFixed(2) })];
      if (p.ma > 0) out.push(ln(TA.sma(r, p.ma), S[4], `MA ${p.ma}`, { width: 1, fmt: (x) => x.toFixed(2) }));
      return { title: `RSI ${p.n}`, series: out, fixed: [0, 100], ticks: [30, 50, 70], fmt: (x) => x.toFixed(0) };
    }
    case "macd": {
      const r = TA.macd(A.c, p.f, p.s, p.g);
      const colors = r.hist.map((x, i) => (!isN(x) ? null : x >= 0 ? (i && x < r.hist[i - 1] ? cx.rgba(P.up, 0.5) : P.up) : (i && x > r.hist[i - 1] ? cx.rgba(P.down, 0.5) : P.down)));
      const f = (x) => cx.fpx(x, Math.min(8, dp + 2));
      return { title: `MACD ${p.f} ${p.s} ${p.g}`, fmt: f, series: [{ kind: "hist", values: r.hist, colors, color: P.up, lv: true, name: "Hist", fmt: f },
        ln(r.macd, S[0], "MACD", { fmt: f }), ln(r.signal, S[1], "Signal", { fmt: f }), { kind: "hline", value: 0, color: P.text, alpha: 0.3, dash: [2, 3], tag: false }] };
    }
    case "atr": {
      const r = TA.atr(A.h, A.l, A.c, p.n);
      const pc = r.map((x, i) => (isN(x) && A.c[i] ? (x / A.c[i]) * 100 : null));
      return { title: `ATR ${p.n}`, fmt: f2, series: [ln(r, S[5], "ATR", { fmt: f2 })], extraLegend: (i) => (isN(pc[i]) ? `${pc[i].toFixed(2)}% of price` : "") };
    }
    case "adx": {
      const r = TA.dmi(A.h, A.l, A.c, p.n, p.s);
      const f = (x) => x.toFixed(1);
      return { title: `DMI ${p.n} ${p.s}`, fmt: f, series: [{ kind: "hline", value: 25, color: P.text, dash: [4, 4], alpha: 0.4, tag: false },
        ln(r.adx, S[4], "ADX", { fmt: f, width: 2 }), ln(r.plus, P.up, "+DI", { fmt: f, width: 1 }), ln(r.minus, P.down, "−DI", { fmt: f, width: 1 })] };
    }
    case "stoch": {
      const r = TA.stoch(A.h, A.l, A.c, p.k, p.ks, p.d);
      const f = (x) => x.toFixed(2);
      return { title: `Stoch ${p.k} ${p.ks} ${p.d}`, fixed: [0, 100], ticks: [20, 50, 80], fmt: (x) => x.toFixed(0), series: [{ kind: "zone", lo: 20, hi: 80, color: S[0], alpha: 0.05 },
        { kind: "hline", value: 80, color: P.text, dash: [4, 4], alpha: 0.5, tag: false }, { kind: "hline", value: 20, color: P.text, dash: [4, 4], alpha: 0.5, tag: false },
        ln(r.k, S[0], "%K", { fmt: f }), ln(r.d, S[1], "%D", { fmt: f, width: 1 })] };
    }
    case "obv": {
      const r = TA.obv(A.c, A.v);
      return { title: "OBV", fmt: (x) => compact(x, 2), series: [ln(r, S[3], "OBV", { fmt: (x) => compact(x, 2) })] };
    }
    case "oi": {
      const D = cx.perp, rows = (D && D.oi) || [];
      const v = TA.stepAt(A.t, A.barMs, rows.map((r) => r[0]), rows.map((r) => r[1]));
      if (D && D.now && isN(D.now.oi) && A.n) v[A.n - 1] = D.now.oi;                    // the forming bar: now
      const first = v.findIndex(isN);
      const note = !D ? "loading" : D.error ? `unavailable (${D.error})` : !rows.length ? "not recorded for this market yet" : first > 0 ? `recorded since ${cx.since(A.t[first])}` : "";
      return { title: "Open interest", note, fmt: usd, series: [ln(v, S[0], "OI", { fmt: usd, step: A.barMs < 900e3, area: cx.rgba(S[0], 0.18), width: 1.6 })],
        extraLegend: (i) => { if (!isN(v[i])) return ""; const j = A.t.findIndex((t) => t >= A.t[i] - 86400e3); const b = v[j]; return isN(b) && b && j < i ? `24h ${v[i] >= b ? "+" : "−"}${(Math.abs(v[i] / b - 1) * 100).toFixed(1)}%` : ""; } };
    }
    case "funding": {
      const D = cx.perp, rows = (D && D.fund) || [];
      const ts = rows.map((r) => r[0]), rt = rows.map((r) => r[1]);
      let hr;
      if (A.barMs >= 3600e3) {
        const s = TA.sumIn(A.t, A.barMs, ts, rt), cnt = TA.sumIn(A.t, A.barMs, ts, rt.map(() => 1));
        hr = s.map((x, i) => (isN(x) && cnt[i] ? x / cnt[i] : null));
      } else hr = TA.stepAt(A.t, A.barMs, ts, rt);
      if (D && D.now && isN(D.now.fund) && A.n) hr[A.n - 1] = D.now.fund;              // the forming bar: the live rate
      const apr = hr.map((x) => (isN(x) ? x * 24 * 365 * 100 : null));
      const colors = apr.map((x) => (!isN(x) ? null : x >= 0 ? cx.rgba(P.up, 0.8) : cx.rgba(P.down, 0.8)));
      const f = (x) => `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 2 : 1)}%`;
      const note = !D ? "loading" : D.error ? `unavailable (${D.error})` : !rows.length ? "no funding recorded for this market" : "";
      return { title: "Funding (APR)", note, fmt: f, series: [{ kind: "hist", values: apr, colors, color: P.up, lv: true, tag: true, name: "APR", fmt: f },
        { kind: "hline", value: 0, color: P.text, alpha: 0.35, tag: false }],
        extraLegend: (i) => (isN(hr[i]) ? `${(hr[i] * 100).toFixed(4)}%/h` : "") };
    }
    default: return { title: id, series: [] };
  }
}

// ---------------------------------------------------------------------------------------------------------- legend
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ICON = {
  eye: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  trend: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19 20 5"/><circle cx="4" cy="19" r="1.8"/><circle cx="20" cy="5" r="1.8"/></svg>',
  ray: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 18 21 7"/><circle cx="4" cy="18" r="1.8"/></svg>',
  hline: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h20"/><circle cx="12" cy="12" r="1.8"/></svg>',
  vline: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v20"/><circle cx="12" cy="12" r="1.8"/></svg>',
  rect: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
  fib: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h18M3 10h18M3 14h18M3 19h18"/></svg>',
  measure: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M3 12h18"/></svg>',
};

function legendRow(id, title, vals, { note = "", extra = "", hidden = false } = {}) {
  const acts = `<span class="acts"><button class="lgb" data-lg="hide" data-ind="${id}" title="${hidden ? "Show" : "Hide"}" aria-label="${hidden ? "Show" : "Hide"} ${esc(title)}">${hidden ? ICON.eyeOff : ICON.eye}</button>` +
    (IND[id] && IND[id].params.length ? `<button class="lgb" data-lg="set" data-ind="${id}" title="Settings" aria-label="Settings of ${esc(title)}">${ICON.gear}</button>` : "") +
    `<button class="lgb" data-lg="del" data-ind="${id}" title="Remove" aria-label="Remove ${esc(title)}">${ICON.x}</button></span>`;
  return `<div class="lgr${hidden ? " off" : ""}" data-ind="${id}"><span class="nm">${esc(title)}</span>${hidden ? "" : vals}${!hidden && extra ? `<span class="muted">${esc(extra)}</span>` : ""}${!hidden && note ? `<span class="note">${esc(note)}</span>` : ""}${acts}</div>`;
}
function seriesVals(r, i) {
  const out = [];
  for (const s of r.series) {
    if (s.legendVals) { for (const q of s.legendVals) { const x = q.arr[i]; out.push(`<span class="v"${q.color ? ` style="color:${q.color}"` : ""}>${q.label ? `<i>${esc(q.label)}</i> ` : ""}${isN(x) ? esc(q.fmt(x)) : "—"}</span>`); } continue; }
    if (!s.lv) continue;
    const x = s.values ? s.values[i] : null;
    const col = s.colors && s.colors[i] ? s.colors[i] : s.color;
    out.push(`<span class="v" style="color:${col}">${isN(x) ? esc((s.fmt || String)(x)) : "—"}</span>`);
  }
  return out.join("");
}
/* The legends: the market's row (OHLC of the bar under the cursor, else the last) over the price pane, a row for each
   study in its pane, with hide, settings and remove on hover. Returns {paneId: html}. */
export function legends(built, i, head) {
  const { A, outs, inds, f } = built;
  const prev = i > 0 ? A.c[i - 1] : null, ch = prev ? A.c[i] - prev : null, cls = A.c[i] >= A.o[i] ? "up" : "dn";
  const rows = { price: [`<div class="lgr main">${head}<span class="ohlc ${cls}"><span class="ov xo"><i>O</i>${f(A.o[i])}</span><span class="ov xo"><i>H</i>${f(A.h[i])}</span><span class="ov xo"><i>L</i>${f(A.l[i])}</span><span class="ov"><i>C</i>${f(A.c[i])}</span>` +
    `${ch != null ? `<span class="chg">${ch >= 0 ? "+" : "−"}${f(Math.abs(ch))} (${ch >= 0 ? "+" : "−"}${(Math.abs(ch / prev) * 100).toFixed(2)}%)</span>` : ""}</span>${i >= A.closedN ? '<span class="note">forming</span>' : ""}</div>`] };
  for (const x of inds) {
    if (!x.on || !outs[x.id]) continue;
    const r = outs[x.id];
    const row = legendRow(x.id, r.title, seriesVals(r, i), { note: r.note, extra: r.extraLegend ? r.extraLegend(i) : "", hidden: x.hidden });
    const pane = IND[x.id].pane === "price" ? "price" : x.id;
    (rows[pane] = rows[pane] || []).push(row);
  }
  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.join("")]));
}

// ---------------------------------------------------------------------------------------------------------- the menus
/* The indicators menu of a window: search, categories, each study with its toggle and (when on) its settings; the chart
   type and the price scale at the foot. */
export function indMenu(w, ui) {
  const q = (ui.q || "").toLowerCase(), cat = ui.cat || "All", on = (k) => w.inds.some((x) => x.id === k && x.on);
  const ids = IND_ORDER.filter((k) => (q ? (IND[k].name + " " + IND[k].desc + " " + IND[k].cat).toLowerCase().includes(q) : cat === "All" ? true : cat === "On" ? on(k) : IND[k].cat === cat));
  const n = w.inds.filter((x) => x.on).length;
  const row = (k) => {
    const x = w.inds.find((y) => y.id === k), isOn = on(k), open = ui.set === k && isOn && IND[k].params.length;
    return `<div class="tc-irow${isOn ? " on" : ""}"><button class="tc-tog" data-indtog="${k}" aria-pressed="${isOn}" aria-label="${isOn ? "Remove" : "Add"} ${esc(IND[k].name)}">${isOn ? "✓" : "+"}</button>` +
      `<div class="tc-ib"><b>${esc(IND[k].name)}</b> <span class="wh">${IND[k].pane === "own" ? "own pane" : "on price"}</span><div class="ds">${esc(IND[k].desc)}</div></div>` +
      (isOn && IND[k].params.length ? `<button class="tc-ic${open ? " on" : ""}" data-indset="${k}" title="Settings" aria-label="Settings of ${esc(IND[k].name)}" aria-expanded="${!!open}">${ICON.gear}</button>` : "<span></span>") +
      (open ? `<form class="tc-iform" data-ind="${k}">${IND[k].params.map((pq) => `<label><span>${esc(pq.label)}</span>${pq.type === "select"
        ? `<select name="${pq.k}">${pq.options.map((o) => `<option${o === x.p[pq.k] ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : `<input name="${pq.k}" type="number" inputmode="decimal" value="${x.p[pq.k]}" min="${pq.min}" max="${pq.max}" step="${pq.step || 1}">`}</label>`).join("")}<button type="button" class="tc-lnk" data-inddef="${k}">Defaults</button></form>` : "") + "</div>";
  };
  return `<div class="tc-pop-h"><b>Indicators</b><em>${n} on</em><span class="grow"></span><button class="tc-ic" data-pop="close" aria-label="Close">${ICON.x}</button></div>` +
    `<input class="tc-pop-q" type="search" placeholder="Search indicators" value="${esc(ui.q || "")}" aria-label="Search indicators" autocomplete="off" spellcheck="false">` +
    `<div class="tc-pop-cats">${CATS.map((c) => `<button data-cat="${c}" aria-pressed="${!q && c === cat}">${c}${c === "On" ? `<em>${n}</em>` : ""}</button>`).join("")}</div>` +
    `<div class="tc-pop-list">${ids.map(row).join("") || `<div class="tc-pop-empty">${cat === "On" && !q ? "none on: add one from All" : "no indicator matches"}</div>`}</div>` +
    `<div class="tc-pop-f"><label>Chart <select data-ctype>${TYPES.map(([k, l]) => `<option value="${k}"${k === (w.type || "candles") ? " selected" : ""}>${l}</option>`).join("")}</select></label>` +
    `<span class="tc-seg" role="group" aria-label="Price scale">${SCALES.map(([k, l]) => `<button type="button" data-scale="${k}" aria-pressed="${k === (w.scale || "normal")}" title="${{ normal: "Price scale: linear", log: "Price scale: logarithmic", pct: "Price scale: percent from the first bar in view" }[k]}">${l}</button>`).join("")}</span></div>`;
}

/* The drawing tools of a window: the tool for the next drawing, the magnet, hide, and clear this market's drawings. */
export function drawMenu(w, tool, nDraw, magnet, hide) {
  return `<div class="tc-pop-h"><b>Drawings</b><em>${nDraw} on this market</em><span class="grow"></span><button class="tc-ic" data-pop="close" aria-label="Close">${ICON.x}</button></div>` +
    `<div class="tc-tools">${TOOLS.map(([k, l, key]) => `<button data-tool="${k}" aria-pressed="${k === tool}">${ICON[k]}<span>${l}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`).join("")}</div>` +
    `<div class="tc-pop-f"><button type="button" data-dopt="magnet" aria-pressed="${!!magnet}" class="tc-chk" title="Snap points to the bars' open, high, low and close">Magnet</button>` +
    `<button type="button" data-dopt="hide" aria-pressed="${!!hide}" class="tc-chk">Hide all</button><span class="grow"></span>` +
    `<button type="button" data-dopt="clear" class="tc-lnk"${nDraw ? "" : " disabled"}>Clear this market's</button></div>` +
    `<div class="tc-pop-tip">Click a drawing to select it; Delete removes it. Drawings stay with the market.</div>`;
}
