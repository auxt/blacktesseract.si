// HyperLight's indicators (Project HyperTrader, web/js/ta.js), copied for TesseractCharts on 14 Nov 2026.
// Technical indicators for the chart (Manual trading). Pure functions over arrays; a value is null until the indicator has
// enough bars (no zeros pretending to be data). Conventions follow TradingView's built-ins: averages start with a
// simple average of their first n values, RSI / ATR / ADX use Wilder's smoothing, standard deviations are over the
// whole population of the window.

const isN = (x) => x !== null && x !== undefined && Number.isFinite(x);

export function sma(src, n) {
  const out = new Array(src.length).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (isN(x)) { sum += x; cnt++; } else { sum = 0; cnt = 0; continue; }
    if (cnt > n) { sum -= src[i - n]; cnt = n; }
    if (cnt === n) out[i] = sum / n;
  }
  return out;
}

// exponential family: alpha = 2/(n+1) (EMA) or 1/n (Wilder's RMA), seeded with the SMA of the first n values
function smooth(src, n, alpha) {
  const out = new Array(src.length).fill(null);
  let acc = null, run = 0, sum = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (acc === null) {
      if (!isN(x)) { run = 0; sum = 0; continue; }
      run++; sum += x;
      if (run > n) sum -= src[i - n];
      if (run >= n) { acc = sum / n; out[i] = acc; }
      continue;
    }
    if (isN(x)) acc = alpha * x + (1 - alpha) * acc;
    out[i] = acc;
  }
  return out;
}
export const ema = (src, n) => smooth(src, n, 2 / (n + 1));
export const rma = (src, n) => smooth(src, n, 1 / n);

export function wma(src, n) {
  const out = new Array(src.length).fill(null);
  const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < n; k++) { const x = src[i - k]; if (!isN(x)) { ok = false; break; } s += x * (n - k); }
    if (ok) out[i] = s / den;
  }
  return out;
}

export function stdev(src, n) {
  const out = new Array(src.length).fill(null);
  let s = 0, s2 = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!isN(x)) { s = 0; s2 = 0; cnt = 0; continue; }
    s += x; s2 += x * x; cnt++;
    if (cnt > n) { const y = src[i - n]; s -= y; s2 -= y * y; cnt = n; }
    if (cnt === n) {
      const m = s / n;
      out[i] = Math.sqrt(Math.max(0, s2 / n - m * m));
    }
  }
  return out;
}

const binop = (a, b, f) => a.map((x, i) => (isN(x) && isN(b[i]) ? f(x, b[i]) : null));

export function bollinger(src, n = 20, k = 2) {
  const mid = sma(src, n), sd = stdev(src, n);
  return { mid, upper: binop(mid, sd, (m, s) => m + k * s), lower: binop(mid, sd, (m, s) => m - k * s),
    width: mid.map((m, i) => (isN(m) && isN(sd[i]) && m ? (2 * k * sd[i]) / m : null)) };
}

export function rsi(c, n = 14) {
  const up = new Array(c.length).fill(null), dn = new Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) {
    if (!isN(c[i]) || !isN(c[i - 1])) continue;
    const d = c[i] - c[i - 1];
    up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0);
  }
  const au = rma(up, n), ad = rma(dn, n);
  return au.map((u, i) => {
    const d = ad[i];
    if (!isN(u) || !isN(d)) return null;
    if (d === 0) return u === 0 ? 50 : 100;
    return 100 - 100 / (1 + u / d);
  });
}

export function macd(c, fast = 12, slow = 26, sig = 9) {
  const line = binop(ema(c, fast), ema(c, slow), (a, b) => a - b);
  const signal = ema(line, sig);
  return { macd: line, signal, hist: binop(line, signal, (a, b) => a - b) };
}

export function trueRange(h, l, c) {
  return h.map((x, i) => (i === 0 || !isN(c[i - 1]) ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}
export const atr = (h, l, c, n = 14) => rma(trueRange(h, l, c), n);

export function dmi(h, l, c, n = 14, smoothing = 14) {
  const len = h.length;
  const pdm = new Array(len).fill(null), ndm = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
    pdm[i] = up > down && up > 0 ? up : 0;
    ndm[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(h, l, c).map((x, i) => (i === 0 ? null : x));
  const trur = rma(tr, n), p = rma(pdm, n), m = rma(ndm, n);
  const plus = binop(p, trur, (a, b) => (b ? (100 * a) / b : 0));
  const minus = binop(m, trur, (a, b) => (b ? (100 * a) / b : 0));
  const dx = binop(plus, minus, (a, b) => (a + b ? (100 * Math.abs(a - b)) / (a + b) : 0));
  return { plus, minus, adx: rma(dx, smoothing) };
}

// highest / lowest over the last n values, O(length) with monotonic queues
function extreme(src, n, better) {
  const out = new Array(src.length).fill(null);
  const q = [];
  let head = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    while (q.length > head && !better(src[q[q.length - 1]], x)) q.pop();
    q.push(i);
    while (q[head] <= i - n) head++;
    if (i >= n - 1) out[i] = src[q[head]];
  }
  return out;
}
export const highest = (src, n) => extreme(src, n, (a, b) => a > b);
export const lowest = (src, n) => extreme(src, n, (a, b) => a < b);

export function stoch(h, l, c, kLen = 14, kSmooth = 3, dSmooth = 3) {
  const hh = highest(h, kLen), ll = lowest(l, kLen);
  const raw = c.map((x, i) => (isN(hh[i]) && isN(ll[i]) ? (hh[i] - ll[i] ? (100 * (x - ll[i])) / (hh[i] - ll[i]) : 50) : null));
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

export function donchian(h, l, n = 20) {
  const upper = highest(h, n), lower = lowest(l, n);
  return { upper, lower, mid: binop(upper, lower, (a, b) => (a + b) / 2) };
}

// Supertrend (ATR bands that only tighten in the trend's direction). dir: 1 up, -1 down.
export function supertrend(h, l, c, n = 10, mult = 3) {
  const a = atr(h, l, c, n);
  const len = c.length;
  const line = new Array(len).fill(null), dir = new Array(len).fill(null);
  let upPrev = null, dnPrev = null, d = -1;               // starts on the upper band, as TradingView's does
  for (let i = 0; i < len; i++) {
    if (!isN(a[i])) continue;
    const mid = (h[i] + l[i]) / 2;
    let up = mid - mult * a[i], dn = mid + mult * a[i];
    if (upPrev !== null && !(c[i - 1] < upPrev)) up = Math.max(up, upPrev);
    if (dnPrev !== null && !(c[i - 1] > dnPrev)) dn = Math.min(dn, dnPrev);
    if (upPrev !== null) {
      if (d === -1 && c[i] > dn) d = 1;
      else if (d === 1 && c[i] < up) d = -1;
    }
    line[i] = d === 1 ? up : dn;
    dir[i] = d;
    upPrev = up; dnPrev = dn;
  }
  return { line, dir };
}

export function obv(c, v) {
  const out = new Array(c.length).fill(null);
  let acc = 0;
  for (let i = 0; i < c.length; i++) {
    if (i > 0) acc += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
    out[i] = acc;
  }
  return out;
}

// period keys in UTC: D day, W week (from Monday), M month
export function periodKey(t, anchor) {
  const day = Math.floor(t / 86400000);
  if (anchor === "W") return Math.floor((day + 3) / 7);
  if (anchor === "M") { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  return day;
}

// VWAP re-anchored each period, with volume-weighted standard-deviation bands
export function vwap(t, h, l, c, v, anchor = "D", mults = [1, 2]) {
  const len = c.length;
  const mid = new Array(len).fill(null);
  const bands = mults.map(() => ({ upper: new Array(len).fill(null), lower: new Array(len).fill(null) }));
  let key = null, sv = 0, spv = 0, spv2 = 0;
  for (let i = 0; i < len; i++) {
    const k = periodKey(t[i], anchor);
    if (k !== key) { key = k; sv = 0; spv = 0; spv2 = 0; }
    const tp = (h[i] + l[i] + c[i]) / 3, vol = Math.max(0, v[i] || 0);
    sv += vol; spv += tp * vol; spv2 += tp * tp * vol;
    if (sv <= 0) continue;
    const m = spv / sv, sd = Math.sqrt(Math.max(0, spv2 / sv - m * m));
    mid[i] = m;
    mults.forEach((x, j) => { bands[j].upper[i] = m + x * sd; bands[j].lower[i] = m - x * sd; });
  }
  return { mid, bands };
}

// the previous period's high, low and close at every bar (key levels)
export function prevLevels(t, h, l, c, anchor = "D") {
  const len = c.length;
  const ph = new Array(len).fill(null), pl = new Array(len).fill(null), pc = new Array(len).fill(null);
  let key = null, curH = -Infinity, curL = Infinity, curC = null, lastH = null, lastL = null, lastC = null;
  for (let i = 0; i < len; i++) {
    const k = periodKey(t[i], anchor);
    if (k !== key) {
      if (key !== null) { lastH = curH; lastL = curL; lastC = curC; }
      key = k; curH = -Infinity; curL = Infinity;
    }
    curH = Math.max(curH, h[i]); curL = Math.min(curL, l[i]); curC = c[i];
    ph[i] = lastH; pl[i] = lastL; pc[i] = lastC;
  }
  return { high: ph, low: pl, close: pc };
}

export function heikinAshi(o, h, l, c) {
  const len = c.length;
  const ho = new Array(len), hh = new Array(len), hl = new Array(len), hc = new Array(len);
  for (let i = 0; i < len; i++) {
    hc[i] = (o[i] + h[i] + l[i] + c[i]) / 4;
    ho[i] = i === 0 ? (o[i] + c[i]) / 2 : (ho[i - 1] + hc[i - 1]) / 2;
    hh[i] = Math.max(h[i], ho[i], hc[i]);
    hl[i] = Math.min(l[i], ho[i], hc[i]);
  }
  return { o: ho, h: hh, l: hl, c: hc };
}

// a step series sampled at times ts (ascending, ms) -> its latest value at or before each bar's close
export function stepAt(barT, barMs, ts, vals) {
  const out = new Array(barT.length).fill(null);
  let j = -1;
  for (let i = 0; i < barT.length; i++) {
    const end = barT[i] + barMs;
    while (j + 1 < ts.length && ts[j + 1] < end) j++;
    if (j >= 0) out[i] = vals[j];
  }
  return out;
}

// sum of a series sampled at times ts within each bar (funding paid per bar)
export function sumIn(barT, barMs, ts, vals) {
  const out = new Array(barT.length).fill(null);
  let j = 0;
  for (let i = 0; i < barT.length; i++) {
    const a = barT[i], b = a + barMs;
    while (j < ts.length && ts[j] < a) j++;
    let s = null, k = j;
    while (k < ts.length && ts[k] < b) { s = (s || 0) + vals[k]; k++; }
    out[i] = s;
  }
  return out;
}
