/**
 * Отрисовка плитки печатной карты рельефа.
 *
 * Вход: те же высоты и расстояние до моря, которые игра считает для всей планеты (редкий растр),
 * поверх них накладывается детальный шум. Детализация только визуальная: города, порты и дороги
 * остаются на своих местах, а вокруг городов береговая линия не уходит в воду.
 * Модуль не зависит от браузера и состояния игры, поэтому его можно запускать в воркере и в тестах.
 */
import { noise3, ridged } from "./noise";

export const TILE = 256;
/** Высота игровой карты в метрах при значении 1. */
export const ELEV_M = 5900;
const ICE_LAT = 78;

export interface ReliefBase {
  /** Размер растра высот. Отсчёты лежат в точках (i·K, j·K), K = worldW / W. */
  W: number;
  H: number;
  /** Высота 0..1 (умножается на ELEV_M). */
  E: Float32Array;
  /** Расстояние до берега, км: меньше нуля в море. */
  SD: Float32Array;
  biomeW: number;
  biomeH: number;
  biome: Uint8Array;
  seed: number;
  worldW: number;
  worldH: number;
  /** x, y городов пара за парой, км. */
  anchors: number[];
}
export interface PreparedBase extends ReliefBase {
  K: number;
  /** Цвет биома по клеткам, 3 числа на клетку. */
  tint: Float32Array;
}

type Rgb = [number, number, number];
const BIOME_TINT: Rgb[] = [
  [104, 157, 169], // океан
  [170, 186, 164], // тундра
  [128, 152, 112], // тайга
  [138, 168, 112], // умеренные леса
  [198, 190, 124], // степи и саванны
  [228, 202, 150], // пустыни
  [108, 154, 112], // тропические леса
  [164, 154, 138], // высокогорья
  [190, 164, 116], // средиземноморье
];
const RAMP: [number, Rgb][] = [
  [0, [172, 190, 138]],
  [250, [190, 202, 142]],
  [700, [214, 206, 144]],
  [1300, [222, 192, 134]],
  [2100, [201, 160, 112]],
  [3000, [168, 126, 94]],
  [4000, [158, 138, 126]],
  [5000, [214, 208, 204]],
];

export function prepareBase(base: ReliefBase): PreparedBase {
  const tint = new Float32Array(base.biomeW * base.biomeH * 3);
  for (let i = 0; i < base.biome.length; i++) {
    const c = BIOME_TINT[base.biome[i]] || BIOME_TINT[3];
    tint[i * 3] = c[0];
    tint[i * 3 + 1] = c[1];
    tint[i * 3 + 2] = c[2];
  }
  return { ...base, K: base.worldW / base.W, tint };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const fadeFor = (wave: number, pixKm: number) => clamp((wave / pixKm - 2) / 2, 0, 1);

function cubic(t: number, p0: number, p1: number, p2: number, p3: number) {
  return (
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}
function wrapI(i: number, n: number) {
  return ((i % n) + n) % n;
}
/** Высота игровой карты (0..1) в точке мира, бикубическая интерполяция. */
export function sampleE(b: PreparedBase, wx: number, wy: number): number {
  const u = wx / b.K,
    v = wy / b.K,
    i = Math.floor(u),
    j = Math.floor(v),
    fx = u - i,
    fy = v - j,
    rows = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    const row = clamp(j - 1 + r, 0, b.H - 1) * b.W;
    rows[r] = cubic(
      fx,
      b.E[row + wrapI(i - 1, b.W)],
      b.E[row + wrapI(i, b.W)],
      b.E[row + wrapI(i + 1, b.W)],
      b.E[row + wrapI(i + 2, b.W)],
    );
  }
  return cubic(fy, rows[0], rows[1], rows[2], rows[3]);
}
/** Расстояние до берега, км, билинейная интерполяция. */
export function sampleSD(b: PreparedBase, wx: number, wy: number): number {
  const u = wx / b.K,
    v = wy / b.K,
    i = Math.floor(u),
    j = Math.floor(v),
    fx = u - i,
    fy = v - j,
    r0 = clamp(j, 0, b.H - 1) * b.W,
    r1 = clamp(j + 1, 0, b.H - 1) * b.W,
    i0 = wrapI(i, b.W),
    i1 = wrapI(i + 1, b.W);
  const a = b.SD[r0 + i0] + (b.SD[r0 + i1] - b.SD[r0 + i0]) * fx,
    c = b.SD[r1 + i0] + (b.SD[r1 + i1] - b.SD[r1 + i0]) * fx;
  return a + (c - a) * fy;
}
function sampleTint(b: PreparedBase, wx: number, wy: number, out: Rgb) {
  const u = (wx / b.worldW) * b.biomeW - 0.5,
    v = (wy / b.worldH) * b.biomeH - 0.5,
    i = Math.floor(u),
    j = Math.floor(v),
    fx = u - i,
    fy = v - j,
    j0 = clamp(j, 0, b.biomeH - 1) * b.biomeW,
    j1 = clamp(j + 1, 0, b.biomeH - 1) * b.biomeW,
    i0 = wrapI(i, b.biomeW),
    i1 = wrapI(i + 1, b.biomeW);
  for (let c = 0; c < 3; c++) {
    const a =
        b.tint[(j0 + i0) * 3 + c] + (b.tint[(j0 + i1) * 3 + c] - b.tint[(j0 + i0) * 3 + c]) * fx,
      d = b.tint[(j1 + i0) * 3 + c] + (b.tint[(j1 + i1) * 3 + c] - b.tint[(j1 + i0) * 3 + c]) * fx;
    out[c] = a + (d - a) * fy;
  }
}

/** Береговая линия: игровое расстояние до моря плюс детали и «подушка» вокруг городов, км. */
function detailedSD(
  b: PreparedBase,
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  pixKm: number,
  anchors: number[],
) {
  let sd = sampleSD(b, wx, wy);
  if (Math.abs(sd) < 120) {
    const R = b.worldW / (2 * Math.PI);
    const px = R * cx,
      py = R * cy;
    sd +=
      (noise3(px / 70, py / 70, wy / 70, b.seed + 501) - 0.5) * 38 * fadeFor(70, pixKm) +
      (noise3(px / 22, py / 22, wy / 22, b.seed + 503) - 0.5) * 14 * fadeFor(22, pixKm) +
      (noise3(px / 7, py / 7, wy / 7, b.seed + 507) - 0.5) * 4 * fadeFor(7, pixKm);
  }
  for (let a = 0; a < anchors.length; a += 2) {
    let dx = Math.abs(anchors[a] - wx);
    if (dx > b.worldW / 2) dx = b.worldW - dx;
    const d = Math.hypot(dx, anchors[a + 1] - wy);
    if (d < ANCHOR_KM) sd += ANCHOR_BIAS * (1 - d / ANCHOR_KM);
  }
  return sd;
}
// Запас больше самой большой детали береговой линии (28 км): город всегда остаётся на суше.
const ANCHOR_KM = 30;
const ANCHOR_BIAS = 36;

/** Высота и расстояние до берега в точке мира, для проверок и подсказок. */
export function terrainAt(b: PreparedBase, wx: number, wy: number, pixKm = 1) {
  const x = wrapI(Math.round(wx * 1000), Math.round(b.worldW * 1000)) / 1000,
    theta = (2 * Math.PI * x) / b.worldW,
    anchors = nearbyAnchors(b, x, wy, 60);
  const sd = detailedSD(b, x, wy, Math.cos(theta), Math.sin(theta), pixKm, anchors);
  if (sd < 0) return { sd, e: 0 };
  return { sd, e: landHeight(b, x, wy, Math.cos(theta), Math.sin(theta), pixKm) };
}
function landHeight(
  b: PreparedBase,
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  pixKm: number,
) {
  let e = Math.max(0, sampleE(b, wx, wy)) * ELEV_M;
  const mask = smooth(250, 1700, e);
  const R = b.worldW / (2 * Math.PI),
    px = R * cx,
    py = R * cy;
  // горы получают полную детализацию, равнины слабую
  e += ridged(px, py, wy, b.seed, pixKm) * (420 * (1 - mask) + 2300 * mask);
  e +=
    (1 - mask) *
      (noise3(px / 45, py / 45, wy / 45, b.seed + 601) - 0.5) *
      170 *
      fadeFor(45, pixKm) +
    (noise3(px / 12, py / 12, wy / 12, b.seed + 607) - 0.5) *
      50 *
      (0.3 + mask) *
      fadeFor(12, pixKm);
  return e;
}
function nearbyAnchors(b: PreparedBase, wx: number, wy: number, r: number): number[] {
  const out: number[] = [];
  for (let a = 0; a < b.anchors.length; a += 2) {
    let dx = Math.abs(b.anchors[a] - wx);
    if (dx > b.worldW / 2) dx = b.worldW - dx;
    if (dx < r && Math.abs(b.anchors[a + 1] - wy) < r) out.push(b.anchors[a], b.anchors[a + 1]);
  }
  return out;
}

function hypsometric(m: number, out: Rgb) {
  if (m <= RAMP[0][0]) return copy(RAMP[0][1], out);
  for (let i = 1; i < RAMP.length; i++)
    if (m <= RAMP[i][0]) {
      const a = RAMP[i - 1],
        c = RAMP[i],
        t = (m - a[0]) / (c[0] - a[0]);
      out[0] = a[1][0] + (c[1][0] - a[1][0]) * t;
      out[1] = a[1][1] + (c[1][1] - a[1][1]) * t;
      out[2] = a[1][2] + (c[1][2] - a[1][2]) * t;
      return out;
    }
  return copy(RAMP[RAMP.length - 1][1], out);
}
function copy(a: Rgb, out: Rgb) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}
function mixInto(c: Rgb, to: Rgb | number[], t: number) {
  c[0] += (to[0] - c[0]) * t;
  c[1] += (to[1] - c[1]) * t;
  c[2] += (to[2] - c[2]) * t;
}

// Свет из северо-запада.
const LIGHT = (() => {
  const v = [-0.58, -0.62, 0.52],
    n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
})();
const SHADOW_DIR = [-0.72, -0.69];
const SHADOW_KM = 80;

/** Размер плитки уровня L в мире. */
export function tileSize(base: { worldW: number; worldH: number }, L: number) {
  return { tw: base.worldW / 2 ** (L + 1), th: base.worldH / 2 ** L };
}

/** Рисует плитку: возвращает RGBA 256×256. */
export function renderTile(b: PreparedBase, L: number, tx: number, ty: number): Uint8ClampedArray {
  const { tw, th } = tileSize(b, L),
    kx = tw / TILE,
    ky = th / TILE,
    pixKm = (kx + ky) / 2,
    x0 = tx * tw,
    y0 = ty * th;
  const shadowPx = clamp(Math.round(SHADOW_KM / pixKm), 2, 56),
    OFF = shadowPx + 2,
    GW = TILE + OFF + 3,
    GH = TILE + OFF + 3;
  const cosT = new Float32Array(GW),
    sinT = new Float32Array(GW),
    wxs = new Float64Array(GW);
  for (let gx = 0; gx < GW; gx++) {
    const wx = x0 + (gx - OFF + 0.5) * kx,
      theta = (2 * Math.PI * wx) / b.worldW;
    wxs[gx] = wrapI(wx * 1000, Math.round(b.worldW * 1000)) / 1000;
    cosT[gx] = Math.cos(theta);
    sinT[gx] = Math.sin(theta);
  }
  const anchors = nearbyAnchors(
    b,
    x0 + tw / 2,
    y0 + th / 2,
    Math.max(tw, th) / 2 + ANCHOR_KM + 4 * pixKm,
  );

  const E = new Float32Array(GW * GH),
    SD = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const wy = clamp(y0 + (gy - OFF + 0.5) * ky, 0, b.worldH);
    for (let gx = 0; gx < GW; gx++) {
      const g = gy * GW + gx,
        sd = detailedSD(b, wxs[gx], wy, cosT[gx], sinT[gx], pixKm, anchors);
      SD[g] = sd;
      E[g] = sd < 0 ? 0 : landHeight(b, wxs[gx], wy, cosT[gx], sinT[gx], pixKm);
    }
  }
  // лёгкое размытие 3×3 убирает «рябь» от самых мелких октав
  const Eb = new Float32Array(GW * GH);
  for (let gy = 1; gy < GH - 1; gy++)
    for (let gx = 1; gx < GW - 1; gx++) {
      const g = gy * GW + gx;
      Eb[g] =
        (E[g] * 4 +
          (E[g - 1] + E[g + 1] + E[g - GW] + E[g + GW]) * 2 +
          E[g - GW - 1] +
          E[g - GW + 1] +
          E[g + GW - 1] +
          E[g + GW + 1]) /
        16;
    }

  const dxm = kx * 1000,
    dym = ky * 1000,
    zf = 7.5 * Math.pow(clamp(pixKm / 1.4, 1, 14), 0.6),
    sLen = Math.hypot(SHADOW_DIR[0] * dxm, SHADOW_DIR[1] * dym),
    rise = Math.tan(0.52) * sLen,
    shadowOff = pixKm <= 6 ? clamp(Math.round(6 / pixKm), 1, 4) : 0;

  const out = new Uint8ClampedArray(TILE * TILE * 4),
    c: Rgb = [0, 0, 0],
    tint: Rgb = [0, 0, 0];
  const R = b.worldW / (2 * Math.PI);
  for (let py = 0; py < TILE; py++) {
    const wy = clamp(y0 + (py + 0.5) * ky, 0, b.worldH),
      lat = Math.abs(90 - (wy / b.worldH) * 180),
      iceT = smooth(ICE_LAT - 0.6, ICE_LAT + 0.6, lat);
    for (let px = 0; px < TILE; px++) {
      const g = (py + OFF) * GW + (px + OFF),
        sd = SD[g],
        gx = px + OFF,
        wx = wxs[gx],
        o = (py * TILE + px) * 4;
      if (sd < 0) {
        const depth = Math.pow(clamp(-sd / 170, 0, 1), 0.6);
        c[0] = 150 + (98 - 150) * depth;
        c[1] = 198 + (154 - 198) * depth;
        c[2] = 220 + (188 - 220) * depth;
        if (shadowOff && SD[g - shadowOff * GW - shadowOff] >= 0)
          mixInto(c, [58, 98, 128], 0.3 * (1 - clamp(-sd / 40, 0, 1) * 0.4));
        const line = 0.55 * pixKm;
        if (sd > -line) mixInto(c, [52, 88, 108], 0.42 * (1 + sd / line));
      } else {
        const m = Eb[g];
        hypsometric(m, c);
        // раскраска по биомам: заметнее в низинах, к горам исчезает
        const warp =
          (noise3((R * cosT[gx]) / 40, (R * sinT[gx]) / 40, wy / 40, b.seed + 701) - 0.5) * 40;
        sampleTint(b, wx + warp, wy + warp * 0.7, tint);
        const curv = (Eb[g - 1] + Eb[g + 1] + Eb[g - GW] + Eb[g + GW]) * 0.25 - m,
          snow = smooth(4200, 5400, m + curv * 3);
        mixInto(c, tint, 0.55 * (1 - smooth(1200, 2800, m)) * (1 - snow));
        mixInto(c, [244, 246, 249], snow * 0.9);
        const gxs = (Eb[g + 1] - Eb[g - 1]) / (2 * dxm),
          gys = (Eb[g + GW] - Eb[g - GW]) / (2 * dym),
          steep = Math.min(1, Math.hypot(gxs, gys) * 2.2);
        mixInto(c, [150, 132, 118], smooth(0.25, 0.7, steep) * 0.4 * (1 - snow));
        const dzx = gxs * zf,
          dzy = gys * zf,
          nl = Math.hypot(dzx, dzy, 1),
          lam = Math.max(0, (-dzx * LIGHT[0] - dzy * LIGHT[1] + LIGHT[2]) / nl) / LIGHT[2];
        let sh = clamp(1 + (lam - 1) * 1.1, 0.25, 1.6),
          cast = 0;
        for (let k = 1; k <= shadowPx; k++) {
          const sx = px + OFF + Math.round(SHADOW_DIR[0] * k),
            sy = py + OFF + Math.round(SHADOW_DIR[1] * k),
            over = Eb[sy * GW + sx] - (m + k * rise);
          if (over > 0) {
            cast = Math.max(cast, Math.min(1, over / 350));
            if (cast >= 1) break;
          }
        }
        let f = sh * (1 - 0.5 * cast) + clamp(curv, -150, 150) * 0.0016;
        f = clamp(f, 0.22, snow > 0.4 ? 1.08 : 1.55);
        c[0] *= f;
        c[1] *= f;
        c[2] *= f;
        mixInto(c, [48, 66, 104], clamp(1 - f, 0, 0.7) * 0.32); // холодные тени
        if (f > 1) mixInto(c, [255, 244, 218], clamp((f - 1) * 0.28, 0, 0.22)); // тёплые света
        const line = 0.55 * pixKm;
        if (sd < line) mixInto(c, [74, 96, 96], 0.3 * (1 - sd / line));
      }
      if (iceT > 0) {
        const pxn = R * cosT[gx],
          pyn = R * sinT[gx],
          ice = noise3(pxn / 110, pyn / 110, wy / 110, b.seed + 801),
          crack = noise3(pxn / 19, pyn / 19, wy / 19, b.seed + 803),
          tone = clamp(0.58 + ice * 0.38, 0, 1),
          crease = clamp((0.13 - Math.abs(crack - 0.5)) * 1.25, 0, 0.15);
        const cap: Rgb = [
          161 + (239 - 161) * tone,
          207 + (248 - 207) * tone,
          219 + (249 - 219) * tone,
        ];
        mixInto(cap, [91, 151, 172], crease);
        mixInto(c, cap, iceT);
      }
      // зерно бумаги
      const grain = (hashPix(px, py, tx, ty) - 0.5) * 5;
      out[o] = c[0] + grain;
      out[o + 1] = c[1] + grain;
      out[o + 2] = c[2] + grain;
      out[o + 3] = 255;
    }
  }
  return out;
}
function hashPix(x: number, y: number, tx: number, ty: number) {
  let h = Math.imul(x + tx * 256, 0x27d4eb2d) ^ Math.imul(y + ty * 256, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
