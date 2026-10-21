import { RW } from "./config";
import { GOODS } from "./economy";
import { wrapX } from "./model";
import { S } from "./state";

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeNoise(rng) {
  const v = new Float32Array(64 * 64);
  for (let i = 0; i < v.length; i++) v[i] = rng();
  return function (x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      xf = x - xi,
      yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = v[((yi & 63) << 6) | (xi & 63)],
      b = v[((yi & 63) << 6) | ((xi + 1) & 63)],
      c = v[(((yi + 1) & 63) << 6) | (xi & 63)],
      d = v[(((yi + 1) & 63) << 6) | ((xi + 1) & 63)];
    const u = s(xf),
      w = s(yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
export function fbm(n, x, y) {
  return n(x, y) * 0.55 + n(x * 2.1 + 17, y * 2.1 + 9) * 0.3 + n(x * 4.3 + 31, y * 4.3 + 5) * 0.15;
}
export function wrappedNoise(n, x, y, scale) {
  const cycles = Math.max(1, Math.round(RW / (64 * scale)));
  return n((wrapX(x) / RW) * (64 * cycles), y / scale);
}
export function wrappedFbm(n, x, y, scale) {
  function q(k, ox, oy) {
    const sc = scale / k,
      cycles = Math.max(1, Math.round(RW / (64 * sc)));
    return n((wrapX(x) / RW) * (64 * cycles) + ox, y / sc + oy);
  }
  return q(1, 0, 0) * 0.55 + q(2.1, 17, 9) * 0.3 + q(4.3, 31, 5) * 0.15;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function weightedOrder(w, rng, k?) {
  const n = w.length;
  if (!k || k >= n) {
    const keys = new Float64Array(n),
      arr = new Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = Math.log(rng() + 1e-12) / w[i];
      arr[i] = i;
    }
    arr.sort((a, b) => keys[b] - keys[a]);
    return k ? arr.slice(0, k) : arr;
  }
  // Efraimidis-Spirakis keys select the same weighted sample as a full sort.
  // Keep only the requested top-k entries instead of sorting every map cell.
  const keys = [],
    arr = [];
  for (let i = 0; i < n; i++) {
    const weight = w[i];
    if (!(weight > 0)) continue;
    const key = Math.log(rng() + 1e-12) / weight;
    if (arr.length < k) {
      let p = arr.length++;
      arr[p] = i;
      keys[p] = key;
      while (p) {
        const parent = (p - 1) >> 1;
        if (keys[parent] <= key) break;
        arr[p] = arr[parent];
        keys[p] = keys[parent];
        p = parent;
        arr[p] = i;
        keys[p] = key;
      }
    } else if (key > keys[0]) {
      let p = 0;
      while (true) {
        let c = p * 2 + 1;
        if (c >= k) break;
        if (c + 1 < k && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        arr[p] = arr[c];
        keys[p] = keys[c];
        p = c;
      }
      arr[p] = i;
      keys[p] = key;
    }
  }
  const selected = arr.map((i, j) => ({ i, key: keys[j] }));
  selected.sort((a, b) => b.key - a.key);
  return selected.map((v) => v.i);
}
export function fmtPop(p) {
  if (p >= 1e6) return (p / 1e6).toFixed(p >= 1e7 ? 1 : 2).replace(".", ",") + " млн";
  if (p >= 1e4) return Math.round(p / 1000) + " тыс.";
  if (p >= 1000) return (p / 1000).toFixed(1).replace(".", ",") + " тыс.";
  return String(Math.round(p));
}
export function fmtM(v) {
  return (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString()).replace(".", ",") + " млрд";
}
export function fmtN(v) {
  return Math.round(v).toLocaleString("ru-RU");
}
export function fmtCargoTonnes(v) {
  v = Math.max(0, v || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(".", ",") + " млрд т";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".", ",") + " млн т";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(".", ",") + " тыс. т";
  if (v > 0 && v < 1) return v < 0.001 ? fmtN(v * 1e6) + " г" : fmtN(v * 1e3) + " кг";
  return fmtN(v) + " т";
}
export function pricePerTonne(g) {
  return GOODS[g] ? ((S.prices[g] || GOODS[g].p) * 1e9) / GOODS[g].tonnes : 0;
}
export function fmtTonPrice(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(".", ",") + " млрд ₽/т";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".", ",") + " млн ₽/т";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(".", ",") + " тыс. ₽/т";
  return fmtN(v) + " ₽/т";
}
export function fmtT(t) {
  return t < 90 ? Math.round(t) + " мин" : (t / 60).toFixed(1).replace(".", ",") + " ч";
}
export function pct(v, d?) {
  return (v > 0 ? "+" : "") + (v * 100).toFixed(d == null ? 1 : d).replace(".", ",") + "%";
}
export function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
}
export function $(s: string): any {
  return document.querySelector(s);
}
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
