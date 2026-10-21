import { reliefReset } from "./relief/tiles";
import {
  ABAND,
  BIZ,
  CELLKM,
  EMPTY,
  G,
  HIGH,
  HIST,
  IND,
  IZHS,
  MID,
  RH,
  RW,
  SKY,
  WATER,
} from "./config";
import { drawViewportImage } from "./draw";
import { C, S, biomeImg, dEdit, mdraw, setTerrainImg, terrainImg, texVer } from "./state";
import { BIOMES, elevVal, forestVal, reliefHeightAt, soilVal } from "./terrain";
import { clamp, wrappedFbm, wrappedNoise } from "./util";
import { mtVal, seaD } from "./worldgen";

const CKEYS = [
  "paper",
  "paper-2",
  "ink",
  "ink-soft",
  "rule",
  "accent",
  "grow",
  "decline",
  "flow",
  "ok",
  "no",
  "c-ground",
  "c-ground-dark",
  "c-soil",
  "c-forest",
  "c-water",
  "c-izhs",
  "c-mid",
  "c-high",
  "c-hist",
  "c-ind",
  "c-aband",
  "c-road",
  "c-metro",
  "c-biz",
  "c-rail",
  "c-air",
  "c-roadfill",
  "c-sky",
  "c-rock",
  "s-ind",
  "s-mine",
  "s-agro",
  "s-wood",
  "s-it",
  "s-tour",
  "s-gov",
  "s-serv",
  "s-log",
];
export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  CKEYS.forEach((k) => {
    C[k] = hex(cs.getPropertyValue("--" + k).trim());
  });
}
export function hex(s) {
  s = (s || "#888").replace("#", "");
  if (s.length === 3)
    s = s
      .split("")
      .map((x) => x + x)
      .join("");
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgb = (a, al?) =>
  al == null
    ? "rgb(" + a[0] + "," + a[1] + "," + a[2] + ")"
    : "rgba(" + a[0] + "," + a[1] + "," + a[2] + "," + al + ")";
export const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
export function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const RELIEF_STOPS: [number, number[]][] = [
  [0, [204, 194, 171]],
  [0.045, [225, 211, 180]],
  [0.12, [222, 209, 179]],
  [0.24, [205, 190, 163]],
  [0.4, [176, 163, 143]],
  [0.6, [158, 154, 148]],
  [0.78, [211, 214, 209]],
  [1, [248, 248, 242]],
];
function reliefColor(h) {
  for (let i = 1; i < RELIEF_STOPS.length; i++) {
    const a = RELIEF_STOPS[i - 1],
      b = RELIEF_STOPS[i];
    if (h <= b[0]) return mix(a[1], b[1], clamp((h - a[0]) / (b[0] - a[0]), 0, 1));
  }
  return RELIEF_STOPS[RELIEF_STOPS.length - 1][1];
}
export function makeBiomeImg(T) {
  if (!T.biomeGrid) return null;
  const W = T.biomeGrid.W,
    H = T.biomeGrid.H,
    cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H);
  for (let i = 0; i < T.biomeGrid.data.length; i++) {
    const b = BIOMES[T.biomeGrid.data[i]],
      col = b.color,
      p = i * 4;
    im.data[p] = parseInt(col.slice(1, 3), 16);
    im.data[p + 1] = parseInt(col.slice(3, 5), 16);
    im.data[p + 2] = parseInt(col.slice(5, 7), 16);
    im.data[p + 3] = T.biomeGrid.data[i] ? 178 : 0;
  }
  x.putImageData(im, 0, 0);
  return cv;
}
export function drawBiomeLayer(ctx, s, shift = 0, w = 0, h = 0, OX = 0, OY = 0) {
  const img = S.T.biomeImg || biomeImg;
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.imageSmoothingEnabled = true;
  drawViewportImage(ctx, img, s, shift, w, h, OX, OY);
  ctx.restore();
}
export function buildTerrainImg() {
  if (!S) return;
  const W = 2048,
    H = Math.round((2048 * RH) / RW),
    K = RW / W,
    cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H),
    atlas = !!S.planet;
  const pad = 2,
    EW = W + pad * 2,
    E = new Float32Array(EW * (H + pad * 2)),
    SD = atlas ? new Float32Array(W * H) : null;
  for (let py = 0; py < H + pad * 2; py++)
    for (let px = 0; px < EW; px++) {
      const wx = (px - pad) * K,
        wy = (py - pad) * K,
        sd = atlas ? seaD(wx, wy) : 0;
      E[py * EW + px] = atlas ? reliefHeightAt(wx, wy, sd) : elevVal(wx, wy);
      if (atlas && px >= pad && px < W + pad && py >= pad && py < H + pad)
        SD[(py - pad) * W + px - pad] = sd;
    }
  const land = atlas ? [221, 207, 176] : C["c-ground"],
    highland = atlas ? [154, 132, 101] : C["c-ground-dark"],
    soil = atlas ? [191, 171, 134] : C["c-soil"],
    forest = atlas ? [158, 169, 137] : C["c-forest"],
    forestDark = atlas ? [119, 133, 107] : mix(C["c-forest"], C["c-ground-dark"], 0.55),
    seaLight = atlas ? [148, 190, 204] : mix(C["c-water"], [112, 180, 193], 0.34),
    seaDark = atlas ? [48, 80, 102] : mix(C["c-water"], [9, 38, 63], 0.58);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const wx = px * K,
        wy = py * K,
        f = atlas ? 0 : forestVal(wx, wy),
        so = atlas ? 0 : soilVal(wx, wy),
        q = (py + pad) * EW + px + pad,
        e = E[q];
      const gx = E[q + 1] - E[q - 1],
        gy = E[q + EW] - E[q - EW],
        slope = Math.hypot(gx, gy),
        oldShade = clamp(
          0.82 + (gx * 0.78 + gy * 0.62) * 380 - Math.max(0, slope - 0.004) * 5,
          0.48,
          1.2,
        ),
        heightTint = clamp((e - 0.3) * (atlas ? 1.05 : 1.25), 0, atlas ? 0.68 : 0.72),
        slopeKm = (5900 / (2 * K)) * slope,
        mean4 = (E[q - 2] + E[q + 2] + E[q - 2 * EW] + E[q + 2 * EW]) * 0.25,
        reliefShade = atlas && SD[py * W + px] > 120 ? Math.max(0, mean4 - e) * 5900 : 0,
        shade = atlas
          ? clamp(
              0.92 +
                (gx * 0.78 + gy * 0.62) * (5900 / (2 * K)) * 0.034 -
                Math.max(0, slopeKm - 5) * 0.0052 -
                Math.min(420, reliefShade) * 0.00011,
              0.6,
              1.22,
            )
          : oldShade,
        m = shade;
      let col = atlas ? reliefColor(e) : mix(land, highland, heightTint);
      if (!atlas && so > 0.55 && f <= 0.6) col = mix(col, soil, clamp((so - 0.55) * 8, 0, 0.9));
      if (!atlas && f > 0.6) {
        const tex = S.T.nD(wx * 0.55, wy * 0.55),
          canopy = clamp((tex - 0.32) * 1.15 + (0.64 - f) * 0.55, 0, 0.66),
          patch = mix(forest, forestDark, canopy);
        col = patch;
        if (f < 0.63) col = mix(col, forestDark, 0.3);
      }
      let mm = m,
        sd = 1e9;
      if (S.T.sea) {
        sd = atlas ? SD[py * W + px] : seaD(wx, wy);
        if (sd < 0) {
          if (atlas) {
            col = [104, 157, 169];
            mm = 1;
          } else {
            const depth = clamp((-sd - 18) / 3200, 0, 1),
              base = mix(seaLight, seaDark, Math.pow(depth, 0.72));
            col = mix(base, C["c-water"], 0.09 * clamp((S.T.nD(wx, wy) - 0.28) * 2.2, 0, 1));
            mm = 1;
          }
        }
      }
      if (S.T.tectonics && mm !== 1 && !atlas) {
        const mt = mtVal(wx, wy);
        if (mt > 0.34) {
          col = mix(col, [112, 108, 99], clamp((mt - 0.3) * 1.1, 0, 0.78));
          if (mt > 0.76) {
            const snow = clamp((mt - 0.78) * 2.5, 0, 0.55);
            col = mix(col, [226, 234, 231], snow);
          }
        }
      }
      if (S.T.sea && Math.abs(sd) < 36 && (!atlas || sd >= 0)) {
        const shore =
            sd < 0
              ? atlas
                ? [153, 192, 200]
                : [151, 203, 209]
              : atlas
                ? [211, 195, 155]
                : [211, 199, 162],
          band = Math.exp(-Math.abs(sd) / 19) * (sd < 0 ? 0.22 : 0.27);
        col = mix(col, shore, band);
      }
      if (S.planet) {
        const lat = Math.abs(90 - (wy / RH) * 180);
        if (lat > 78) {
          const ice = wrappedFbm(S.T.nD, wx, wy, 110),
            crack = wrappedNoise(S.T.nF, wx, wy, 19),
            iceTone = clamp(0.58 + ice * 0.38, 0, 1),
            crease = clamp((0.13 - Math.abs(crack - 0.5)) * 1.25, 0, 0.15);
          col = mix([161, 207, 219], [239, 248, 249], iceTone);
          col = mix(col, [91, 151, 172], crease);
          mm = 0.98;
        }
      }
      const p = (py * W + px) * 4;
      im.data[p] = clamp(col[0] * mm, 0, 255);
      im.data[p + 1] = clamp(col[1] * mm, 0, 255);
      im.data[p + 2] = clamp(col[2] * mm, 0, 255);
      im.data[p + 3] = 255;
    }
  x.putImageData(im, 0, 0);
  setTerrainImg(cv);
  if (atlas) publishRelief(E, EW, pad, SD, W, H);
}
/** Отдаёт плиткам рельефа те же высоты и расстояния до моря, что посчитала игра для всей планеты. */
function publishRelief(E, EW, pad, SD, W, H) {
  const flat = new Float32Array(W * H);
  for (let py = 0; py < H; py++)
    flat.set(E.subarray((py + pad) * EW + pad, (py + pad) * EW + pad + W), py * W);
  let sum = 0;
  for (let i = 0; i < 97; i++)
    sum += flat[(i * 20011) % flat.length] + SD[(i * 30011) % SD.length] * 1e-3;
  const biome = S.T.biomeGrid;
  reliefReset(
    {
      W,
      H,
      E: flat,
      SD: new Float32Array(SD),
      biomeW: biome ? biome.W : 1,
      biomeH: biome ? biome.H : 1,
      biome: biome ? new Uint8Array(biome.data) : new Uint8Array([3]),
      seed: (S.seed | 0) >>> 0,
      worldW: RW,
      worldH: RH,
      anchors: S.cities.flatMap((c) => [c.x, c.y]),
    },
    [S.seed, S.continentCount, S.worldVersion, W, H, sum.toFixed(5)].join("|"),
  );
}
export function footprint(c) {
  const key = S.year + "|" + c.builtCells + "|" + c.aband + "|" + texVer;
  if (c.fp && c.fpKey === key) return c.fp;
  const cv = c.fp || document.createElement("canvas");
  cv.width = G;
  cv.height = G;
  const x = cv.getContext("2d"),
    im = x.createImageData(G, G);
  const TC = [
    null,
    C["c-izhs"],
    C["c-mid"],
    C["c-high"],
    C["c-aband"],
    C["c-ind"],
    C["c-hist"],
    null,
    C["c-biz"],
    C["c-sky"],
  ];
  for (let k = 0; k < G * G; k++) {
    const t = c.grid[k],
      col = TC[t];
    if (!col) continue;
    const p = k * 4;
    im.data[p] = col[0];
    im.data[p + 1] = col[1];
    im.data[p + 2] = col[2];
    im.data[p + 3] = t === ABAND ? 150 : t === IZHS ? 200 : 255;
  }
  x.putImageData(im, 0, 0);
  c.fp = cv;
  c.fpKey = key;
  return cv;
}
export function drawFootprint(ctx, c, s) {
  const fp = footprint(c),
    sz = G * CELLKM * s;
  ctx.imageSmoothingEnabled = sz < G * 1.5;
  ctx.drawImage(fp, (c.x - (G / 2) * CELLKM) * s, (c.y - (G / 2) * CELLKM) * s, sz, sz);
}
/* the plan frames the built-up area, so a small town is not a dot in an 18 km square */
export function cityView(c) {
  let need = (c.brad || 4) * 2 + 14;
  (c.sats || []).forEach((i) => {
    const o = S.cities[i];
    if (!o) return;
    need = Math.max(
      need,
      (2 * Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y))) / CELLKM + 2 * (o.brad || 4) + 8,
    );
  });
  c.metro.forEach((l) =>
    l.st.forEach((p) => {
      need = Math.max(need, 2 * Math.max(Math.abs(p[0] - c.cx), Math.abs(p[1] - c.cy)) + 8);
    }),
  );
  if (c.rw)
    need = Math.max(need, 2 * Math.max(Math.abs(c.rw.x - c.cx), Math.abs(c.rw.y - c.cy)) + 26);
  c.districts.forEach((d) =>
    d.pts.forEach((p) => {
      need = Math.max(need, 2 * Math.max(Math.abs(p[0] - c.cx), Math.abs(p[1] - c.cy)) + 6);
    }),
  );
  if ((dEdit && dEdit.target === "city" && dEdit.city === c.i) || (mdraw && mdraw.city === c.i))
    need = Math.max(need, (c.brad || 4) * 2 + 40);
  const size = Math.round(clamp(need, 36, G));
  c.vsize = Math.max(c.vsize || 0, size);
  const sz = c.vsize;
  return { size: sz, x0: clamp(c.cx - sz / 2, 0, G - sz), y0: clamp(c.cy - sz / 2, 0, G - sz) };
}
/* textured city plan */
function hash1(k) {
  return ((Math.imul(k + 1, 2654435761) >>> 0) % 10007) / 10007;
}
function hash2(k) {
  return ((Math.imul(k * 7 + 3, 2246822519) >>> 0) % 9973) / 9973;
}
const texTmp = document.createElement("canvas");
texTmp.width = G;
texTmp.height = G;
export function cityTex(c) {
  const key = S.year + "|" + c.builtCells + "|" + c.aband + "|" + c.H + "|" + texVer;
  if (c.tex && c.texKey === key) return c.tex;
  S.cities.forEach((o) => {
    if (o !== c) o.tex = null;
  });
  const K = 6,
    cv = c.tex || document.createElement("canvas");
  cv.width = G * K;
  cv.height = G * K;
  const x = cv.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0);
  const tctx = texTmp.getContext("2d"),
    im = tctx.createImageData(G, G),
    d = im.data;
  const garden = mix(mix(C["c-ground"], C["c-forest"], 0.3), C["c-izhs"], 0.3);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const k = gy * G + gx,
        t = c.grid[k],
        e = c.elev[k];
      const ex = c.elev[gy * G + Math.min(G - 1, gx + 1)] - c.elev[gy * G + Math.max(0, gx - 1)],
        ey = c.elev[Math.min(G - 1, gy + 1) * G + gx] - c.elev[Math.max(0, gy - 1) * G + gx],
        m = 0.93 + 0.14 * clamp(0.5 - (ex + ey) * 4, 0, 1);
      let col;
      if (t === WATER) col = C["c-water"];
      else if (t === IZHS) col = garden;
      else if (t !== EMPTY) col = mix(C["c-ground"], C["c-ground-dark"], 0.3);
      else
        col = c.forest[k]
          ? mix(C["c-forest"], C["c-ground-dark"], clamp(e - 0.35, 0, 0.4))
          : mix(C["c-ground"], C["c-ground-dark"], clamp((e - 0.3) * 1.2, 0, 1));
      const mm = t === WATER ? 1 : m,
        p = k * 4;
      d[p] = clamp(col[0] * mm, 0, 255);
      d[p + 1] = clamp(col[1] * mm, 0, 255);
      d[p + 2] = clamp(col[2] * mm, 0, 255);
      d[p + 3] = 255;
    }
  tctx.putImageData(im, 0, 0);
  x.imageSmoothingEnabled = true;
  x.drawImage(texTmp, 0, 0, G * K, G * K);
  x.setTransform(K / 5, 0, 0, K / 5, 0, 0);
  const cI = rgb(mix(C["c-izhs"], C["c-high"], 0.35)),
    cM = rgb(C["c-mid"]),
    cMy = rgb(mix(C["c-mid"], C["c-ground"], 0.6)),
    cHb = rgb(mix(C["c-high"], C["c-ground"], 0.65)),
    cH = rgb(C["c-high"]),
    cS = rgb(C["c-hist"]),
    cSl = rgb(mix(C["c-hist"], C["c-ground"], 0.45)),
    cN = rgb(C["c-ind"]),
    cNl = rgb(mix(C["c-ind"], C.paper, 0.35)),
    cA = rgb(C["c-aband"]),
    cAd = rgb(mix(C["c-aband"], C.ink, 0.3)),
    cF = rgb(mix(C["c-forest"], C.ink, 0.18)),
    cWe = rgb(mix(C["c-water"], C.ink, 0.25)),
    shadow = "rgba(0,0,0,0.22)",
    cBz = rgb(mix(C["c-biz"], C["c-ground"], 0.4)),
    cBl = rgb(C["c-biz"]),
    cKb = rgb(mix(C["c-sky"], C["c-ground"], 0.7)),
    cK = rgb(C["c-sky"]),
    cKl = rgb(mix(C["c-sky"], C.paper, 0.55));
  for (let k = 0; k < G * G; k++) {
    const t = c.grid[k],
      X = (k % G) * 5,
      Y = ((k / G) | 0) * 5,
      r1 = hash1(k),
      r2 = hash2(k);
    if (t === EMPTY) {
      if (c.forest[k]) {
        x.fillStyle = cF;
        x.beginPath();
        x.arc(X + 1 + r1 * 3, Y + 1 + r2 * 3, 1.3 + r2 * 0.5, 0, 6.29);
        x.fill();
        if (r1 > 0.4) {
          x.beginPath();
          x.arc(X + 1 + r2 * 3, Y + 1 + (1 - r1) * 3, 1.1, 0, 6.29);
          x.fill();
        }
      }
      continue;
    }
    if (t === WATER) {
      const gx = k % G,
        gy = (k / G) | 0;
      const land = (a, b) => a >= 0 && b >= 0 && a < G && b < G && c.grid[b * G + a] !== WATER;
      x.fillStyle = cWe;
      if (land(gx, gy - 1)) x.fillRect(X, Y, 5, 0.8);
      if (land(gx, gy + 1)) x.fillRect(X, Y + 5 - 0.8, 5, 0.8);
      if (land(gx - 1, gy)) x.fillRect(X, Y, 0.8, 5);
      if (land(gx + 1, gy)) x.fillRect(X + 5 - 0.8, Y, 0.8, 5);
      continue;
    }
    if (t === IZHS) {
      x.fillStyle = cI;
      x.fillRect(X + 0.3 + r1 * 1.0, Y + 0.3 + r2 * 1.0, 2.1, 1.9);
      if (r2 > 0.2) x.fillRect(X + 2.6 + r2 * 0.8, Y + 2.5 + r1 * 0.9, 1.9, 2.1);
      if (r1 > 0.6) x.fillRect(X + 2.8, Y + 0.4, 1.6, 1.5);
      continue;
    }
    if (t === MID) {
      x.fillStyle = cM;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = cMy;
      x.fillRect(X + 1.3, Y + 1.3, 5 - 2.6, 5 - 2.6);
      continue;
    }
    if (t === HIGH) {
      x.fillStyle = cHb;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = shadow;
      x.fillRect(X + 1.1, Y + 1.1, 1.9, 2.9);
      x.fillRect(X + 3.2, Y + 2.4, 1.5, 2.4);
      x.fillStyle = cH;
      x.fillRect(X + 0.5, Y + 0.5, 1.9, 2.9);
      x.fillRect(X + 2.7, Y + 1.8, 1.5, 2.4);
      continue;
    }
    if (t === HIST) {
      x.fillStyle = cS;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = cSl;
      x.fillRect(X + 1.6 + r1 * 1.6, Y, 0.55, 5);
      x.fillRect(X, Y + 1.6 + r2 * 1.6, 5, 0.55);
      continue;
    }
    if (t === IND) {
      x.fillStyle = cN;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = cNl;
      x.fillRect(X + 0.5, Y + 0.6 + r1 * 2, 5 - 1, 1.1);
      continue;
    }
    if (t === BIZ) {
      x.fillStyle = cBz;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = shadow;
      x.fillRect(X + 1.1, Y + 1.1, 1.7, 3.7);
      x.fillStyle = cBl;
      x.fillRect(X + 0.5, Y + 0.5, 1.7, 3.7);
      x.fillRect(X + 2.8, Y + 1.4, 1.6, 3.1);
      continue;
    }
    if (t === SKY) {
      x.fillStyle = cKb;
      x.fillRect(X, Y, 5, 5);
      x.fillStyle = "rgba(0,0,0,0.3)";
      x.beginPath();
      x.moveTo(X + 3.6, Y + 0.6);
      x.lineTo(X + 5, Y + 2);
      x.lineTo(X + 5, Y + 5);
      x.lineTo(X + 2, Y + 5);
      x.lineTo(X + 0.6, Y + 3.6);
      x.closePath();
      x.fill();
      x.fillStyle = cK;
      x.fillRect(X + 0.6, Y + 0.6, 3, 3);
      x.fillStyle = cKl;
      x.fillRect(X + 1.1, Y + 1.1, 0.8, 0.8);
      x.fillRect(X + 2.2, Y + 2.2, 0.8, 0.8);
      continue;
    }
    if (t === ABAND) {
      x.fillStyle = cA;
      x.fillRect(X, Y, 5, 5);
      x.strokeStyle = cAd;
      x.lineWidth = 0.6;
      x.beginPath();
      x.moveTo(X, Y + 5);
      x.lineTo(X + 5, Y);
      x.stroke();
      continue;
    }
  }
  c.tex = cv;
  c.texKey = key;
  return cv;
}
