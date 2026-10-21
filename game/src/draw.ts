import {
  drawRelief,
  reliefBeginFrame,
  reliefHasCoarse,
  setReliefUpdateHandler,
} from "./relief/tiles";
import { accRegion } from "./accessibility";
import { canAct, canFound, capIdx, costOf, financeBook, foundCost, linkCost } from "./actions";
import { planCity } from "./agglomerations";
import { regionAspect } from "./app";
import { stations } from "./city";
import { specColor } from "./colorMode";
import { cityTex, drawBiomeLayer, drawFootprint, footprint, hex, mix, rgb } from "./colors";
import {
  ACT,
  CELLKM,
  DEPOSIT_REACH,
  G,
  PORT_CAPACITY,
  RH,
  RIVER_PORT_REACH,
  RW,
  SECT,
  ST,
  UNI,
  YMAX,
} from "./config";
import {
  drawAirRouteLayer,
  drawAirlineGhost,
  drawCargoGhost,
  drawCargoRouteLayer,
  drawCountryNames,
  drawDist,
  drawRegionDistricts,
  drawRoadGhost,
  drawTerritory,
} from "./districts";
import { GOODS, drawClark, drawMarket, drawProd } from "./economy";
import { PLANT, plantMW } from "./energy";
import { drawNb } from "./foreign";
import {
  DENS_DETAIL_SCALE,
  cityHeat,
  densRegion,
  drawDensityDetail,
  drawHeat,
  drawLegend,
  fmtRub,
  landBase,
  landRegion,
} from "./layers";
import { cityAspect, cityFrame, drawCityOverlays, drawMetroBox, finishMetro } from "./metro";
import {
  AIR_MAX_FREQ,
  airFreqCost,
  airRouteStats,
  airportDefaultCode,
  airportLevelText,
  byKey,
  dist,
  evaluate,
  geoXY,
  linkBetween,
  linkKm,
  logEv,
  nearX,
  wrapX,
} from "./model";
import { onRender, regionName } from "./multiplayer";
import { drawChains, drawDeps, drawEnergy, drawFirms } from "./resources";
import { drawParks } from "./saveload";
import {
  APP_PREFS,
  C,
  CLAYER,
  FLOWS,
  FONT,
  LAYER,
  S,
  TAB,
  TT,
  VIEW,
  claimMode,
  cmode,
  dEdit,
  founding,
  ghost,
  lastGameDate,
  lastPairs,
  mdraw,
  mode,
  placingCapital,
  renaming,
  roadSel,
  setDEdit,
  setLastGameDate,
  setRoadSel,
  terrainImg,
} from "./state";
import {
  areaShares,
  cargoRouteStats,
  hasCargoPort,
  portCapacity,
  portLevel,
  portLevelName,
  riverChannelDist,
  totalCargoRouteCapacity,
} from "./terrain";
import { $, clamp, esc, fmtCargoTonnes, fmtM, fmtN, fmtPop, fmtT, pct } from "./util";
import { toolButtons } from "./views";
import { VIL, drawVillages, villageBoxes, villages } from "./villages";
import { seaPoly } from "./worldgen";
import { drawZoneTable, drawZones } from "./zones";

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
function fit(cv, aspect) {
  const w = cv.clientWidth || cv.parentElement.clientWidth || 600,
    h = Math.round(w * aspect);
  cv.style.height = h + "px";
  const r = dpr();
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return { ctx, w, h };
}
export function fonts() {
  const cs = getComputedStyle(document.documentElement);
  FONT.d = cs.getPropertyValue("--f-display").trim() || "sans-serif";
  FONT.b = cs.getPropertyValue("--f-body").trim() || "sans-serif";
  FONT.m = cs.getPropertyValue("--f-mono").trim() || "monospace";
}
export function halo(ctx, t, x, y) {
  const f = ctx.fillStyle;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = LAYER === "airlinks" ? "rgba(3,12,22,.96)" : rgb(C["c-ground"], 0.9);
  ctx.lineJoin = "round";
  ctx.strokeText(t, x, y);
  ctx.restore();
  ctx.fillStyle = f;
  ctx.fillText(t, x, y);
}
function growthRate(c) {
  const h = c.hist,
    n = h.length;
  if (n < 2) return 0;
  const k = Math.min(5, n - 1);
  return Math.pow(h[n - 1] / h[n - 1 - k], 1 / k) - 1;
}
export function radius(c, s) {
  return 3 + 3 * Math.log10(Math.max(c.PA || c.P, 1000) / 1000) * (V.z > 3 ? 0.7 : 1);
}
function drawPath(ctx, pts, s) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * s, pts[0][1] * s);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * s,
      my = ((pts[i][1] + pts[i + 1][1]) / 2) * s;
    ctx.quadraticCurveTo(pts[i][0] * s, pts[i][1] * s, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1][0] * s, pts[pts.length - 1][1] * s);
  ctx.stroke();
}
function drawRiverPath(ctx, pts, s) {
  if (!pts || pts.length < 2) return;
  let lo = Infinity,
    hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p[0]);
    hi = Math.max(hi, p[0]);
  }
  const shifts = [0];
  if (S.planet && lo < 0) shifts.push(RW);
  if (S.planet && hi > RW) shifts.push(-RW);
  for (const shift of shifts) {
    ctx.beginPath();
    ctx.moveTo((pts[0][0] + shift) * s, pts[0][1] * s);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[Math.max(0, i - 1)],
        b = pts[i],
        c = pts[i + 1],
        d = pts[Math.min(pts.length - 1, i + 2)],
        t = 0.14,
        c1x = (b[0] + (c[0] - a[0]) * t + shift) * s,
        c1y = (b[1] + (c[1] - a[1]) * t) * s,
        c2x = (c[0] - (d[0] - b[0]) * t + shift) * s,
        c2y = (c[1] - (d[1] - b[1]) * t) * s;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, (c[0] + shift) * s, c[1] * s);
    }
    ctx.stroke();
  }
}
function railLine(ctx, ax, ay, bx, by, wd, fast) {
  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = rgb(C["c-rail"]);
  ctx.lineWidth = wd + 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = rgb(fast ? C.accent : C.paper);
  ctx.lineWidth = wd;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}
function plane(ctx, x, y, z) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = rgb(C["c-air"]);
  ctx.strokeStyle = rgb(C.paper);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, z, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = rgb(C.paper);
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -z * 0.65);
  ctx.lineTo(0, z * 0.65);
  ctx.moveTo(-z * 0.6, -z * 0.05);
  ctx.lineTo(z * 0.6, -z * 0.05);
  ctx.moveTo(-z * 0.28, z * 0.5);
  ctx.lineTo(z * 0.28, z * 0.5);
  ctx.stroke();
  ctx.restore();
}
export const V = { z: 1, cx: RW / 2, cy: RH / 2 };
const MAX_WORLD_ZOOM = 4000;
export function mapScaleTier(z = V.z) {
  return z < 3 ? 0 : z < 12 ? 1 : z < 60 ? 2 : 3;
}
function mapScaleLabel(tier = mapScaleTier()) {
  return ["Планетарный", "Континентальный", "Региональный", "Локальный"][tier];
}
export function districtCapitalIds() {
  return new Set(S.regions.map((d) => d.center).filter((i) => i != null));
}
export function cityVisibleAtTier(c, tier, centers) {
  const pop = c.PA || c.P;
  if (tier === 0) return !!c.govc || c.i === 0 || pop >= 3e6;
  if (tier === 1) return !!c.govc || centers.has(c.i);
  if (tier === 2) return !!c.govc || centers.has(c.i) || pop >= 250000;
  return true;
}
export const ROAD_CLASS_RANK = { international: 0, national: 1, regional: 2, local: 3 };
export function roadClass(r, centers = districtCapitalIds()) {
  const a = byKey(r.a),
    b = byKey(r.b),
    km = linkKm(r.a, r.b),
    big = (o) => !!o && !o.ext && (o.govc || (o.PA || o.P) >= 3e6),
    regional = (o) => !!o && !o.ext && (o.govc || (o.PA || o.P) >= 250000 || centers.has(o.i));
  if (ROAD_CLASS_RANK[r.class] != null) return r.class;
  if (a && b && (a.ext || b.ext)) return "international";
  if (km >= 600 || (km >= 150 && (big(a) || big(b))) || (km >= 200 && regional(a) && regional(b)))
    return "national";
  if (km >= 80 || (km >= 20 && (regional(a) || regional(b)))) return "regional";
  return "local";
}
function roadVisibleAtTier(r, tier, centers) {
  const maxRank = tier === 0 ? 1 : tier === 1 ? 2 : 3;
  return ROAD_CLASS_RANK[roadClass(r, centers)] <= maxRank;
}
function clampView(w, h) {
  const s = (w / RW) * V.z,
    hh = h / 2 / s;
  if (S.planet) V.cx = wrapX(V.cx);
  else {
    const hw = w / 2 / s;
    V.cx = hw * 2 >= RW ? RW / 2 : clamp(V.cx, hw, RW - hw);
  }
  V.cy = hh * 2 >= RH ? RH / 2 : clamp(V.cy, hh, RH - hh);
}
export function zoomAt(f, sx, sy) {
  const r = $("#region").getBoundingClientRect(),
    w = r.width,
    h = r.height,
    s = (w / RW) * V.z,
    wx = V.cx + (sx - w / 2) / s,
    wy = V.cy + (sy - h / 2) / s;
  V.z = clamp(V.z * f, 1, MAX_WORLD_ZOOM);
  const s2 = (w / RW) * V.z;
  V.cx = wx - (sx - w / 2) / s2;
  V.cy = wy - (sy - h / 2) / s2;
  clampView(w, h);
  drawRegion();
}
function linkEnds(r) {
  const A = byKey(r.a),
    B = byKey(r.b),
    ax = A.ext ? A.gx : A.x,
    ay = A.ext ? A.gy : A.y;
  let bx = B.ext ? B.gx : B.x;
  if (S.planet) bx = nearX(bx, ax);
  return [ax, ay, bx, B.ext ? B.gy : B.y];
}
function placeLabels(
  ctx,
  s,
  w,
  h,
  OX,
  OY,
  extLabs,
  tier = mapScaleTier(),
  centers = districtCapitalIds(),
) {
  const cs = S.cities,
    visible = cs.filter((c) =>
      LAYER === "airlinks" ? !!c.air : cityVisibleAtTier(c, tier, centers),
    ),
    placed = [];
  const hit = (b) =>
    b.x + OX < 2 ||
    b.y + OY < 2 ||
    b.x + b.w + OX > w - 2 ||
    b.y + b.h + OY > h - 2 ||
    placed.some((p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
  visible.forEach((c) => {
    const r = radius(c, s);
    placed.push({ x: c.x * s - r, y: c.y * s - r, w: 2 * r, h: 2 * r });
    if (c.air) placed.push({ x: c.x * s - r * 0.75 - 7, y: c.y * s - r * 0.75 - 7, w: 14, h: 14 });
  });
  if (APP_PREFS.resources)
    S.T.deps.forEach((d) => placed.push({ x: d.x * s - 6, y: d.y * s - 6, w: 12, h: 12 }));
  if (VIL.show && tier >= 2) villageBoxes(s).forEach((b) => placed.push(b));
  extLabs.forEach((o) => {
    ctx.font = "700 12.5px " + FONT.d;
    const ew = ctx.measureText(o.e.name).width + 4;
    let best = null;
    for (let k = 0; k < 6; k++) {
      const dd = 18 + k * 16,
        lx = clamp(o.x + OX - Math.cos(o.ang) * dd, ew / 2 + 4, w - ew / 2 - 4) - OX,
        ly = clamp(o.y + OY - Math.sin(o.ang) * dd, 16, h - 22) - OY,
        b = { x: lx - ew / 2, y: ly - 12, w: ew, h: 28 };
      if (!best) best = b;
      if (
        !placed.some(
          (p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y,
        )
      ) {
        best = b;
        break;
      }
    }
    placed.push(best);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = rgb(C.ink);
    halo(ctx, o.e.name, best.x + ew / 2, best.y + 12);
    ctx.font = "11px " + FONT.m;
    ctx.fillStyle = rgb(C["ink-soft"]);
    halo(ctx, fmtPop(o.e.P), best.x + ew / 2, best.y + 24);
  });
  const order = visible
    .slice()
    .sort((a, b) => Number(b.i === S.sel) - Number(a.i === S.sel) || b.P - a.P);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  order.forEach((c) => {
    const dispatch = LAYER === "airlinks",
      r = radius(c, s) + 3,
      cx = c.x * s,
      cy = c.y * s,
      sub = dispatch
        ? c.airportName || "Аэропорт " + c.name
        : (c.sats && c.sats.length ? "агломерация " + fmtPop(c.PA) : fmtPop(c.P)) +
          (cmode === "spec" ? " · " + c.spec : "");
    const fs = dispatch
        ? 13
        : Math.round(clamp(11 + 2.3 * Math.log10(Math.max(c.P, 1000) / 1000), 11, 19)),
      nm = dispatch
        ? (c.airportCode || airportDefaultCode(c.name, c.i)).toUpperCase()
        : c.P >= 250000
          ? c.name.toUpperCase()
          : c.name,
      nf = (dispatch || c.P >= 50000 ? "700 " : "600 ") + fs + "px " + FONT.d;
    ctx.font = nf;
    const w1 = ctx.measureText(nm).width;
    ctx.font = "11px " + FONT.m;
    const w2 = ctx.measureText(sub).width;
    const bw = Math.max(w1, w2) + 4,
      bh = fs + 14,
      d = r * 0.72,
      hb = bh / 2;
    const cands = [
      [cx + r, cy - hb],
      [cx - r - bw, cy - hb],
      [cx - bw / 2, cy - r - bh],
      [cx - bw / 2, cy + r],
      [cx + d, cy - d - bh],
      [cx + d, cy + d],
      [cx - d - bw, cy - d - bh],
      [cx - d - bw, cy + d],
      [cx + r + 10, cy - hb],
      [cx - r - bw - 10, cy - hb],
    ];
    let pos = null;
    for (const q of cands) {
      const b = { x: q[0], y: q[1], w: bw, h: bh };
      if (!hit(b)) {
        pos = b;
        break;
      }
    }
    if (!pos) {
      if (tier < 3 && c.i !== S.sel && c.i !== 0 && c.P < 50000) return;
      pos = { x: cands[0][0], y: cands[0][1], w: bw, h: bh };
    }
    placed.push(pos);
    ctx.font = nf;
    ctx.fillStyle = LAYER === "airlinks" ? "#F0F8FC" : rgb(C.ink);
    halo(ctx, nm, pos.x + 2, pos.y + fs - 1);
    ctx.font = "11px " + FONT.m;
    ctx.fillStyle = LAYER === "airlinks" ? "#AFC7D3" : rgb(C["ink-soft"]);
    halo(ctx, sub, pos.x + 2, pos.y + fs + 11);
  });
  ctx.font = "11px " + FONT.b;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const soft = (t, cx, cy, col, font) => {
    ctx.font = font;
    const tw = ctx.measureText(t).width;
    for (const [ox, oy] of [
      [0, 0],
      [0, 30],
      [0, -30],
      [55, 16],
      [-55, 16],
      [0, 56],
      [0, -56],
    ]) {
      const b = { x: cx + ox - tw / 2, y: cy + oy - 8, w: tw, h: 16 };
      if (!hit(b)) {
        placed.push(b);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = col;
        halo(ctx, t, b.x, b.y + 8);
        return;
      }
    }
  };
  if (tier >= 1)
    S.regions.forEach((d) => {
      if (!d.cities.length) return;
      let x = 0,
        y = 0,
        w = 0;
      d.cities.forEach((i) => {
        const c = S.cities[i],
          ww = Math.sqrt(c.P + c.R);
        x += c.x * ww;
        y += c.y * ww;
        w += ww;
      });
      soft(
        d.name.toUpperCase().split("").join(String.fromCharCode(8202)),
        (x / w) * s,
        (y / w) * s,
        rgb(mix(hex(d.color), C.ink, 0.3)),
        "italic 600 11.5px " + FONT.b,
      );
    });
  (S.parks || []).forEach((pk) =>
    soft(
      (pk.type === "np" ? "нацпарк «" : "заповедник «") + pk.name + "»",
      pk.x * s,
      pk.y * s,
      rgb(mix(C["s-wood"], C.ink, 0.35)),
      "italic 12px " + FONT.b,
    ),
  );
}
function drawForeignCountries(ctx, s, tier = mapScaleTier()) {
  S.ext.forEach((e) => {
    const x = e.gx * s,
      y = e.gy * s,
      col = hex(e.color);
    ctx.save();
    (e.cities || []).forEach((c) => {
      const visible =
        tier === 0
          ? !!c.capital || c.P >= 3e6
          : tier === 1
            ? !!c.capital
            : tier === 2
              ? !!c.capital || c.P >= 250000
              : true;
      if (!visible) return;
      const cx = c.x * s,
        cy = c.y * s,
        r = c.capital ? 5 : 2.7;
      ctx.fillStyle = rgb(col, c.capital ? 1 : 0.82);
      ctx.strokeStyle = rgb(C.paper);
      ctx.lineWidth = c.capital ? 1.7 : 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.283);
      ctx.fill();
      ctx.stroke();
      if (tier >= 1 && (!c.capital || tier >= 2)) {
        ctx.font = "10.5px " + FONT.b;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        halo(ctx, c.name, cx + 5, cy - 3);
      }
    });
    ctx.fillStyle = rgb(col);
    ctx.strokeStyle = rgb(C.paper);
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(x, y, 5.2, 0, 6.283);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}
function latitudeY(lat) {
  return (RH * (90 - lat)) / 180;
}
function drawGeoNames(ctx, s, shift, w, h, OX, OY) {
  if (!APP_PREFS.geoNames || !S.T.geoFeatures) return;
  S.T.geoFeatures.forEach((o) => {
    if ((o.kind === "river" || o.kind === "lake" || o.kind === "range") && s < 0.045) return;
    const x = (o.x + shift) * s + OX,
      y = o.y * s + OY;
    if (x < -180 || x > w + 180 || y < -30 || y > h + 30) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font =
      o.kind === "continent"
        ? "italic 700 16px " + FONT.b
        : o.kind === "ocean"
          ? "italic 600 13px " + FONT.b
          : o.kind === "range"
            ? "italic 700 12px " + FONT.b
            : "italic 11px " + FONT.b;
    ctx.fillStyle = rgb(
      o.kind === "ocean"
        ? [196, 220, 231]
        : o.kind === "river" || o.kind === "lake"
          ? [190, 222, 230]
          : o.kind === "range"
            ? [232, 225, 211]
            : o.kind === "ice"
              ? [239, 249, 250]
              : [225, 218, 197],
      o.kind === "ocean" ? 0.78 : 0.92,
    );
    halo(ctx, o.name, x, y);
    ctx.restore();
  });
}
function visibleWraps(w, s) {
  if (!S.planet) return [0];
  const left = V.cx - w / (2 * s),
    right = V.cx + w / (2 * s),
    first = Math.floor(left / RW),
    last = Math.ceil(right / RW) - 1;
  const shifts = [];
  for (let k = first; k <= last; k++) shifts.push(k * RW);
  return shifts;
}
export function drawViewportImage(ctx, img, s, wrapShift, w, h, OX, OY) {
  const left = Math.max(0, -OX / s - wrapShift),
    right = Math.min(RW, (w - OX) / s - wrapShift),
    top = Math.max(0, -OY / s),
    bottom = Math.min(RH, (h - OY) / s);
  if (right <= left || bottom <= top) return;
  ctx.drawImage(
    img,
    (left / RW) * img.width,
    (top / RH) * img.height,
    ((right - left) / RW) * img.width,
    ((bottom - top) / RH) * img.height,
    left * s,
    top * s,
    (right - left) * s,
    (bottom - top) * s,
  );
}
function darkenDispatcherViewport(ctx, s, wrapShift, w, h, OX, OY) {
  const l = Math.max(0, -OX / s - wrapShift),
    r = Math.min(RW, (w - OX) / s - wrapShift),
    t = Math.max(0, -OY / s),
    b = Math.min(RH, (h - OY) / s);
  if (r <= l || b <= t) return;
  ctx.save();
  ctx.fillStyle = "rgba(3,13,24,.74)";
  ctx.fillRect(l * s, t * s, (r - l) * s, (b - t) * s);
  ctx.restore();
}
export function drawResourceOverlay() {
  const cv = $("#resourceOverlay");
  if (!cv) return;
  cv.hidden =
    VIEW !== "region" || LAYER === "airlinks" || LAYER === "cargo" || !APP_PREFS.resources;
  if (cv.hidden || !S || !S.T.deps) return;
  const { ctx, w, h } = fit(cv, regionAspect($("#region")));
  ctx.clearRect(0, 0, w, h);
  clampView(w, h);
  const s = (w / RW) * V.z,
    OX = w / 2 - V.cx * s,
    OY = h / 2 - V.cy * s;
  ctx.save();
  ctx.translate(OX, OY);
  for (const shift of visibleWraps(w, s)) {
    ctx.save();
    ctx.translate(shift * s, 0);
    const left = (-OX - shift * s) / s - 20,
      right = (w - OX - shift * s) / s + 20,
      top = -OY / s - 20,
      bottom = (h - OY) / s + 20;
    for (const d of S.T.deps) {
      if (d.x < left || d.x > right || d.y < top || d.y > bottom) continue;
      const x = d.x * s,
        y = d.y * s,
        z = V.z < 2.2 ? 2.6 : V.z < 4.5 ? 3.2 : 4.2;
      ctx.fillStyle = (d.used || 0) > 0 ? rgb(C["s-mine"]) : rgb(C["c-ground"]);
      ctx.strokeStyle = rgb(C["s-mine"], V.z < 2.2 ? 0.72 : 0.9);
      ctx.lineWidth = V.z < 2.2 ? 1 : 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y - z);
      ctx.lineTo(x + z, y);
      ctx.lineTo(x, y + z);
      ctx.lineTo(x - z, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (s < 0.09) continue;
      ctx.font = "11px " + FONT.b;
      const tw = ctx.measureText(d.t).width;
      let tx = x - tw / 2,
        ty = y + 16;
      if (tx + OX + shift * s < 4) tx = x + 9;
      if (tx + OX + shift * s + tw > w - 4) tx = x - tw - 9;
      if (ty + OY < 14) ty = y - 10;
      ctx.fillStyle = rgb(C["ink-soft"]);
      halo(ctx, d.t, tx, ty);
    }
    ctx.restore();
  }
  ctx.restore();
}
export function drawGeoNameOverlay() {
  const cv = $("#geoNameOverlay");
  if (!cv) return;
  cv.hidden = VIEW !== "region" || LAYER === "airlinks" || LAYER === "cargo" || !APP_PREFS.geoNames;
  if (cv.hidden || !S || !S.T.geoFeatures) return;
  const { ctx, w, h } = fit(cv, regionAspect($("#region")));
  ctx.clearRect(0, 0, w, h);
  clampView(w, h);
  const s = (w / RW) * V.z,
    OX = w / 2 - V.cx * s,
    OY = h / 2 - V.cy * s;
  visibleWraps(w, s).forEach((shift) => drawGeoNames(ctx, s, shift, w, h, OX, OY));
}
function drawGraticule(ctx, s) {
  ctx.save();
  ctx.strokeStyle = rgb(C.paper, 0.12);
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const x = ((RW * i) / 12) * s;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RH * s);
    ctx.stroke();
  }
  for (let i = 1; i < 12; i++) {
    const y = ((RH * i) / 12) * s;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(RW * s, y);
    ctx.stroke();
  }
  ctx.font = "10px " + FONT.m;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < 12; i++) halo(ctx, i * 30 + "°", ((RW * i) / 12) * s + 4, 4);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const lat of [-60, -30, 0, 30, 60])
    halo(ctx, Math.abs(lat) + "°" + (lat > 0 ? "N" : lat < 0 ? "S" : ""), 4, latitudeY(lat) * s);
  ctx.restore();
}
export function drawRegion() {
  if (VIEW !== "region") return;
  const cv = $("#region"),
    { ctx, w, h } = fit(cv, regionAspect(cv)),
    cs = S.cities,
    tier = mapScaleTier(),
    centers = districtCapitalIds(),
    cargoMode = LAYER === "cargo",
    dispatch = LAYER === "airlinks" || cargoMode;
  $("#scaleTierLabel").hidden = false;
  $("#scaleTierLabel").textContent = mapScaleLabel(tier) + " · ×" + Math.round(V.z);
  clampView(w, h);
  const s = (w / RW) * V.z,
    OX = w / 2 - V.cx * s,
    OY = h / 2 - V.cy * s;
  ctx.fillStyle = dispatch ? "#071522" : rgb(C.paper);
  ctx.fillRect(0, 0, w, h);
  // Печатный рельеф рисуется плитками; пока крупные плитки не готовы, показывается прежняя картинка.
  const reliefOn = !!S.planet && APP_PREFS.relief !== false && reliefHasCoarse();
  reliefBeginFrame();
  ctx.save();
  ctx.translate(OX, OY);
  for (const wrapShift of visibleWraps(w, s)) {
    ctx.save();
    ctx.translate(wrapShift * s, 0);
    if (reliefOn) drawRelief(ctx, s, wrapShift, w, h, OX, OY, cs);
    else if (terrainImg) {
      ctx.imageSmoothingEnabled = true;
      drawViewportImage(ctx, terrainImg, s, wrapShift, w, h, OX, OY);
    } else {
      ctx.fillStyle = rgb(C["c-ground"]);
      const l = Math.max(0, -OX / s - wrapShift),
        r = Math.min(RW, (w - OX) / s - wrapShift),
        t = Math.max(0, -OY / s),
        b = Math.min(RH, (h - OY) / s);
      ctx.fillRect(l * s, t * s, Math.max(0, r - l) * s, Math.max(0, b - t) * s);
    }
    if (dispatch) darkenDispatcherViewport(ctx, s, wrapShift, w, h, OX, OY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!dispatch) {
      if (S.T.sea && !S.T.sea.planet) {
        const sp = seaPoly();
        ctx.save();
        ctx.fillStyle = rgb(mix(C["c-water"], C.accent, 0.1));
        ctx.strokeStyle = rgb(mix(C["c-water"], C.ink, 0.3));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        sp.forEach((q, i) => (i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (S.planet && V.z >= 2.4) drawGraticule(ctx, s);
    }
    const heat = !dispatch && (LAYER === "dens" || LAYER === "land" || LAYER === "acc");
    if (!dispatch) {
      if (LAYER === "dens") {
        if (s >= DENS_DETAIL_SCALE) drawDensityDetail(ctx, s, wrapShift, w, h, OX, OY);
        else drawHeat(ctx, s, densRegion(), wrapShift, w, h, OX, OY);
      } else if (LAYER === "land") drawHeat(ctx, s, landRegion(), wrapShift, w, h, OX, OY);
      else if (LAYER === "acc") drawHeat(ctx, s, accRegion(), wrapShift, w, h, OX, OY);
      else if (LAYER === "nature") drawBiomeLayer(ctx, s, wrapShift, w, h, OX, OY);
      drawZones(ctx, s, wrapShift, w, h, OX, OY, tier, centers);
      drawParks(ctx, s);
      if (tier >= 1 || LAYER === "territory" || claimMode)
        drawRegionDistricts(ctx, s, wrapShift, w, h, OX, OY);
      drawForeignCountries(ctx, s, tier);
      drawCountryNames(ctx, s, wrapShift);
      if (tier >= 2) drawVillages(ctx, s);
      S.T.rivers.forEach((r, k) => {
        const major = k < Math.max(2, Math.ceil(S.T.rivers.length * 0.28)),
          lw = Math.max(major ? 0.9 : 0.62, Math.min(7, s * (r.w || 1.4) * 0.68)),
          pts = r.drawPts || r.pts;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(35,75,87,.52)";
        ctx.lineWidth = lw + 1.25;
        drawRiverPath(ctx, pts, s);
        ctx.strokeStyle = major ? "rgba(75,144,166,.92)" : "rgba(88,157,175,.84)";
        ctx.lineWidth = lw;
        drawRiverPath(ctx, pts, s);
        if (major && lw > 1.6) {
          ctx.strokeStyle = "rgba(196,224,228,.44)";
          ctx.lineWidth = Math.max(0.45, lw * 0.16);
          drawRiverPath(ctx, pts, s);
        }
      });
      (S.T.lakes || []).forEach((l) => {
        ctx.fillStyle = "rgba(83,190,224,.76)";
        ctx.strokeStyle = "rgba(17,48,63,.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(l.x * s, l.y * s, l.r * s, 0, 6.283);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.textBaseline = "alphabetic";
    const extBoxes = [];
    if (LAYER !== "airlinks" && !cargoMode)
      S.roads.forEach((r) => {
        if (!roadVisibleAtTier(r, tier, centers)) return;
        const [ax, ay, bx, by] = linkEnds(r);
        let ox = 0,
          oy = 0;
        if (linkBetween(r.a, r.b, r.mode === "rail" ? "road" : "rail")) {
          const L = Math.hypot(bx - ax, by - ay) || 1;
          ox = ((-(by - ay) / L) * (r.mode === "rail" ? 2.2 : -2.2)) / s;
          oy = (((bx - ax) / L) * (r.mode === "rail" ? 2.2 : -2.2)) / s;
        }
        if (r.mode === "rail")
          railLine(ctx, (ax + ox) * s, (ay + oy) * s, (bx + ox) * s, (by + oy) * s, 2, r.fast);
        else {
          const cls = roadClass(r, centers),
            style = {
              local: { c: "#AAB8C1", edge: "#273743", w: 1.35, d: [2, 4] },
              regional: { c: "#F0B761", edge: "#443626", w: 2.25, d: [] },
              national: { c: "#74D6F4", edge: "#123C54", w: 3.25, d: [] },
              international: { c: "#C7A5FF", edge: "#34244F", w: 3.8, d: [10, 5] },
            }[cls],
            cw = style.w + (r.fast ? 1 : 0) + Math.min(1.1, Math.log2(Math.max(1, V.z)) * 0.12),
            ln = () => {
              ctx.beginPath();
              ctx.moveTo((ax + ox) * s, (ay + oy) * s);
              ctx.lineTo((bx + ox) * s, (by + oy) * s);
              ctx.stroke();
            };
          ctx.lineCap = "round";
          ctx.save();
          if (style.d.length) ctx.setLineDash(style.d);
          ctx.strokeStyle = style.edge;
          ctx.lineWidth = cw + 2;
          ln();
          ctx.strokeStyle = r.fast ? "#FFF2A8" : style.c;
          ctx.lineWidth = cw;
          ln();
          if (cls === "international") {
            ctx.setLineDash([2, 7]);
            ctx.strokeStyle = "#F7EEFF";
            ctx.lineWidth = Math.max(0.8, cw * 0.19);
            ln();
          }
          ctx.restore();
        }
      });
    if (LAYER === "airlinks") drawAirRouteLayer(ctx, s);
    if (cargoMode) drawCargoRouteLayer(ctx, s, wrapShift);
    if (lastPairs.length && FLOWS && !heat && LAYER !== "airlinks" && !cargoMode) {
      const top = lastPairs.slice(0, 8),
        mx = top[0].v;
      top.forEach((f) => {
        if (f.v < mx * 0.05) return;
        const A = cs[f.a],
          B = cs[f.b];
        const ax = (S.planet ? nearX(A.x, V.cx) : A.x) * s,
          ay = A.y * s,
          bx = (S.planet ? nearX(B.x, A.x) : B.x) * s,
          by = B.y * s;
        const dx = bx - ax,
          dy = by - ay,
          L = Math.hypot(dx, dy);
        if (L < 1) return;
        const ux = dx / L,
          uy = dy / L;
        const sx = ax + ux * radius(A, s),
          sy = ay + uy * radius(A, s),
          ex = bx - ux * (radius(B, s) + 3),
          ey = by - uy * (radius(B, s) + 3);
        const qx = (sx + ex) / 2 - uy * L * 0.14,
          qy = (sy + ey) / 2 + ux * L * 0.14;
        const lw = 1 + 3.5 * Math.sqrt(f.v / mx);
        ctx.strokeStyle = rgb(C.flow, 0.6);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(qx, qy, ex, ey);
        ctx.stroke();
        const tx = ex - qx,
          ty = ey - qy,
          tl = Math.hypot(tx, ty) || 1,
          hx = tx / tl,
          hy = ty / tl,
          hs = 5 + lw * 1.3;
        ctx.fillStyle = rgb(C.flow, 0.8);
        ctx.beginPath();
        ctx.moveTo(ex + hx * 2, ey + hy * 2);
        ctx.lineTo(ex - hx * hs - hy * hs * 0.6, ey - hy * hs + hx * hs * 0.6);
        ctx.lineTo(ex - hx * hs + hy * hs * 0.6, ey - hy * hs - hx * hs * 0.6);
        ctx.closePath();
        ctx.fill();
      });
    }
    if (!heat && !dispatch && tier >= 2)
      cs.forEach((c) => {
        if (!cityVisibleAtTier(c, tier, centers)) return;
        const size = G * CELLKM * s,
          x = (c.x + wrapShift) * s + OX,
          y = c.y * s + OY;
        if (x + size / 2 < 0 || x - size / 2 > w || y + size / 2 < 0 || y - size / 2 > h) return;
        drawFootprint(ctx, c, s);
      });
    const neutral = dispatch ? [28, 56, 73] : C["paper-2"];
    if (!dispatch && tier >= 2)
      cs.forEach((c) => {
        if (!cityVisibleAtTier(c, tier, centers) || !c.sats || !c.sats.length) return;
        let R = 4;
        c.sats.forEach((i) => {
          R = Math.max(R, dist(c, cs[i]) + 2.5);
        });
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = rgb(C.ink, 0.55);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(c.x * s, c.y * s, R * s, 0, 6.283);
        ctx.stroke();
        ctx.restore();
      });
    cs.forEach((c, i) => {
      if (dispatch ? (cargoMode ? !hasCargoPort(c) : !c.air) : !cityVisibleAtTier(c, tier, centers))
        return;
      const r = radius(c, s),
        g = growthRate(c),
        t = clamp(Math.abs(g) / 0.03, 0, 1);
      const col = heat
        ? C.paper
        : cmode === "spec"
          ? specColor(c)
          : g >= 0
            ? mix(neutral, C.grow, 0.25 + 0.75 * t)
            : mix(neutral, C.decline, 0.25 + 0.75 * t);
      ctx.fillStyle = dispatch ? "#0FE1C2" : rgb(col, V.z > 2.5 ? 0.55 : 0.92);
      ctx.strokeStyle = dispatch ? "#B9FFF1" : rgb(C.ink);
      ctx.lineWidth = c.govc ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(c.x * s, c.y * s, heat ? Math.max(3, r * 0.6) : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (i === S.sel) {
        ctx.strokeStyle = rgb(C.accent);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(c.x * s, c.y * s, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (c.air)
        plane(
          ctx,
          c.x * s - r * 0.75,
          c.y * s - r * 0.75,
          5 + Math.min(3, (c.airLevel || 1) * 0.2),
        );
      if (c.pw && (c.pw.gres || c.pw.ges || c.pw.aes)) {
        const bx = c.x * s + r * 0.8,
          by = c.y * s - r * 0.9;
        ctx.save();
        ctx.fillStyle = "#F2B705";
        ctx.strokeStyle = rgb(C.ink);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 2, by - 6);
        ctx.lineTo(bx - 3, by + 1);
        ctx.lineTo(bx, by + 1);
        ctx.lineTo(bx - 2, by + 7);
        ctx.lineTo(bx + 4, by - 1);
        ctx.lineTo(bx + 1, by - 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (c.station) {
        const z = 3 + c.station,
          sx = c.x * s + r * 0.55,
          sy = c.y * s + r * 0.55;
        ctx.fillStyle = rgb(C["c-rail"]);
        ctx.fillRect(sx, sy, z * 1.5, z);
        ctx.fillStyle = rgb(C.paper);
        ctx.fillRect(sx + 1.2, sy + 1.2, z * 1.5 - 2.4, z - 2.4);
      }
    });
    placeLabels(ctx, s, w, h, OX, OY, extBoxes, tier, centers);
    if (founding && ghost) {
      const why = canFound(ghost.x, ghost.y),
        fc = foundCost(ghost.x, ghost.y),
        okc = !why && S.budget >= fc.cost;
      const col = okc ? C.ok : C.no;
      const n = cs[fc.near],
        nx = S.planet ? nearX(n.x, ghost.x) : n.x;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = rgb(col);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ghost.x * s, ghost.y * s);
      if (fc.connected) ctx.lineTo(nx * s, n.y * s);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = rgb(col, 0.25);
      ctx.strokeStyle = rgb(col);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ghost.x * s, ghost.y * s, 7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const sh = areaShares(ghost.x, ghost.y),
        res = [];
      if (sh.soil > 0.3) res.push("чернозём");
      if (sh.forest > 0.3) res.push("лес");
      if (riverChannelDist(ghost.x, ghost.y) <= RIVER_PORT_REACH) res.push("река");
      S.T.deps.forEach((d) => {
        if (
          (d.used || 0) < 2 &&
          geoXY(d.x, d.y, ghost.x, ghost.y) <= (S.planet ? DEPOSIT_REACH : 18) &&
          res.indexOf(d.t) < 0
        )
          res.push(d.t);
      });
      ctx.font = "12.5px " + FONT.b;
      ctx.fillStyle = rgb(C.ink);
      const txt = why
        ? why
        : (okc
            ? "Основать за " + fmtM(fc.cost) + (fc.connected ? "" : " · без автодороги через море")
            : "Нужно " + fmtM(fc.cost)) + (res.length ? " · " + res.join(", ") : "");
      const tw = ctx.measureText(txt).width;
      let tx = ghost.x * s + 12,
        ty = ghost.y * s - 12;
      if (tx + OX + tw > w - 4) tx = ghost.x * s - 12 - tw;
      if (tx + OX < 4) tx = 4 - OX;
      if (ty + OY < 14) ty = ghost.y * s + 22;
      halo(ctx, txt, tx, ty);
    }
    if (placingCapital && ghost) {
      ctx.save();
      ctx.fillStyle = rgb(C.accent, 0.24);
      ctx.strokeStyle = rgb(C.accent);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ghost.x * s, ghost.y * s, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ghost.x * s - 13, ghost.y * s);
      ctx.lineTo(ghost.x * s + 13, ghost.y * s);
      ctx.moveTo(ghost.x * s, ghost.y * s - 13);
      ctx.lineTo(ghost.x * s, ghost.y * s + 13);
      ctx.stroke();
      ctx.font = "700 12px " + FONT.b;
      ctx.fillStyle = rgb(C.ink);
      halo(ctx, "стартовый город", ghost.x * s + 14, ghost.y * s - 12);
      ctx.restore();
    }
    drawRoadGhost(ctx, s);
    drawAirlineGhost(ctx, s);
    drawCargoGhost(ctx, s);
    ctx.restore();
  }
  ctx.restore();
  const kmOpts = S.planet
      ? [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000]
      : [0.5, 1, 2, 5, 10, 20, 50],
    km = s >= 40 && s <= 130 ? 1 : kmOpts.filter((k) => k * s <= 130).pop() || kmOpts[0],
    bl = km * s,
    bx = 12,
    by = h - 12;
  ctx.fillStyle = rgb(C["c-ground"], 0.85);
  ctx.fillRect(bx - 6, by - 17, bl + 52, 24);
  ctx.strokeStyle = rgb(C.ink);
  ctx.lineWidth = 2;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(bx, by - 4);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bl, by);
  ctx.lineTo(bx + bl, by - 4);
  ctx.stroke();
  ctx.fillStyle = rgb(C.ink);
  ctx.font = "11.5px " + FONT.m;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(km).replace(".", ",") + " км", bx + bl + 6, by + 1);
  drawResourceOverlay();
  drawGeoNameOverlay();
}
const off = document.createElement("canvas");
off.width = G;
off.height = G;
function drawAirportIdentity(c) {
  const box = $("#airportIdentity");
  if (!box) return;
  if (!c.air) {
    box.innerHTML = "";
    box.dataset.sig = "";
    return;
  }
  const sig = [c.i, c.airportName, c.airportCode, c.airLevel].join("|");
  if (box.dataset.sig === sig || box.contains(document.activeElement)) return;
  box.dataset.sig = sig;
  box.innerHTML =
    '<div class="airport-identity"><label>Название аэропорта<input id="airportNameInput" maxlength="40" value="' +
    esc(c.airportName || "Аэропорт " + c.name) +
    '"></label><label>Код аэропорта<input id="airportCodeInput" maxlength="3" value="' +
    esc(c.airportCode || airportDefaultCode(c.name, c.i)) +
    '" aria-label="Трёхбуквенный код аэропорта"></label><button type="button" data-airport-save>Сохранить</button><span class="note" role="status">Уровень ' +
    (c.airLevel || 1) +
    " · " +
    airportLevelText(c.airLevel || 1) +
    " пассажиров в год · загрузка " +
    Math.round(c.paxLoad * 100) +
    "%</span></div>";
}
function drawAirRoutes(c) {
  const box = $("#airRoutesBox");
  if (!box) return;
  drawAirportIdentity(c);
  const routes = (S.airRoutes || [])
    .map((r, i) => ({ r, i, other: r.a === c.i ? r.b : r.b === c.i ? r.a : null }))
    .filter((x) => x.other != null);
  let html = "";
  if (!c.air)
    html =
      '<p class="note">В городе нет аэропорта. Откройте аэропорт в разделе «Строительство», затем соедините его с другим аэропортом.</p>';
  else if (!routes.length)
    html =
      '<p class="note">Авиамаршрутов пока нет. Задайте расписание в числе рейсов за месяц.</p><button type="button" data-tool="airline" aria-pressed="false">Спроектировать авиалинию</button>';
  else
    html = routes
      .map(({ r, i, other }) => {
        const st = airRouteStats(r),
          cst = airFreqCost(r),
          max = st.fpm >= AIR_MAX_FREQ;
        return (
          '<div class="airroute"><b>' +
          esc(S.cities[other].name) +
          " ↔ " +
          esc(c.name) +
          '</b><span class="note">' +
          st.fpm +
          " " +
          plural(st.fpm, "рейс", "рейса", "рейсов") +
          " в месяц · перевезено " +
          fmtN(st.pax) +
          " из " +
          fmtN(st.demand) +
          ' поездок спроса в год</span><div class="roadrow"><button type="button" data-airfreq="' +
          i +
          '" data-delta="-1" aria-label="Снизить число рейсов в месяц"' +
          (st.fpm <= 1 ? " disabled" : "") +
          '>−</button><button type="button" data-airfreq="' +
          i +
          '" data-delta="1"' +
          (max || S.budget < cst ? " disabled" : "") +
          ">+1 рейс в месяц · " +
          fmtM(cst) +
          "</button></div></div>"
        );
      })
      .join("");
  if (c.air && routes.length)
    html +=
      '<button type="button" data-tool="airline" aria-pressed="false">Добавить авиалинию</button>';
  html +=
    '<p class="note">Спрос зависит от населения обоих городов, расстояния и частоты сообщения. Годовой поток ограничен спросом, числом рейсов и ёмкостью аэропортов.</p>';
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
function drawCargoRoutes() {
  const box = $("#cargoRoutesBody");
  if (!box) return;
  const routes = S.cargoRoutes || [],
    seaN = S.cities.filter((c) => portLevel(c, "sea")).length,
    riverN = S.cities.filter((c) => portLevel(c, "river")).length;
  let html =
    '<p class="note">Порты: морских ' +
    seaN +
    ", речных " +
    riverN +
    '. Маршрут связывает два порта одного типа. Доступная грузоподъёмность распределяется между реальными излишками и потребностями городов.</p><div class="roadrow"><button type="button" data-tool="cargoSea" aria-pressed="false">Проложить морской маршрут</button><button type="button" data-tool="cargoRiver" aria-pressed="false">Проложить речной маршрут</button></div>';
  if (!routes.length)
    html +=
      '<p class="note">Линий пока нет. Для морского маршрута нужны два морских порта, для речного — два порта на одном русле.</p>';
  else
    html +=
      '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Маршрут и товары</th><th>Длина</th><th>Перевезено/год</th><th>Стоимость груза</th><th></th></tr></thead><tbody>' +
      routes
        .map((r, i) => {
          const a = S.cities[r.a],
            b = S.cities[r.b],
            st = cargoRouteStats(r),
            flows = r.flows || [],
            details = flows.length
              ? flows
                  .map(
                    (f) =>
                      esc(GOODS[f.good].t) +
                      " · " +
                      fmtCargoTonnes(f.tonnes) +
                      " · " +
                      esc(S.cities[f.from].name) +
                      " → " +
                      esc(S.cities[f.to].name),
                  )
                  .join("<br>")
              : '<span class="note">нет подходящего груза или спроса</span>';
          return (
            '<tr><td class="l">' +
            (r.type === "sea" ? "Морской" : "Речной") +
            " · " +
            esc(a.name) +
            " ↔ " +
            esc(b.name) +
            "<br>" +
            details +
            "</td><td>" +
            fmtN(st.km) +
            " км</td><td>" +
            fmtCargoTonnes(r.annualTonnes || 0) +
            " из " +
            fmtCargoTonnes(st.capacity) +
            "</td><td>" +
            fmtM(r.annualValue || 0) +
            '</td><td><button type="button" data-cargorm="' +
            i +
            '" aria-label="Закрыть маршрут">×</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table></div>";
  const cap = totalCargoRouteCapacity();
  html +=
    '<p class="note">Пропускная способность всех маршрутов: ' +
    fmtCargoTonnes(cap) +
    " в год. Выпуск и потребление городов пересчитываются каждый месяц; значения здесь показаны в годовом исчислении.</p>";
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
export function drawCity() {
  if (mdraw && mdraw.city !== planCity().i) finishMetro(true);
  if (dEdit && dEdit.target === "city" && dEdit.city !== S.sel) {
    setDEdit(null);
    toolButtons();
  }
  const c = S.cities[S.sel],
    pc = planCity();
  $("#viewC").textContent = "План: " + pc.name;
  if (VIEW === "city") {
    $("#scaleTierLabel").hidden = true;
    const c = pc,
      cv = $("#city"),
      { ctx, w, h } = fit(cv, cityAspect(cv)),
      VW = cityFrame(c, w, h),
      s = VW.s;
    ctx.save();
    ctx.translate(-VW.x0 * s, -VW.y0 * s);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cityTex(c), 0, 0, G * s, G * s);
    if (CLAYER !== "plan") {
      ctx.fillStyle = rgb(C.paper, 0.5);
      ctx.fillRect(0, 0, G * s, G * s);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cityHeat(c, CLAYER), 0, 0, G * s, G * s);
      ctx.imageSmoothingEnabled = true;
    }
    S.cities.forEach((o) => {
      if (o === c) return;
      const dx = (o.x - c.x) / CELLKM,
        dy = (o.y - c.y) / CELLKM;
      if (Math.abs(dx) > G || Math.abs(dy) > G) return;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = o.core === c.i ? 1 : 0.55;
      ctx.drawImage(footprint(o), dx * s, dy * s, G * s, G * s);
      ctx.restore();
      if (o.i === S.sel) {
        ctx.save();
        ctx.strokeStyle = rgb(C.accent);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc((o.cx + dx) * s, (o.cy + dy) * s, Math.max(14, (o.brad || 4) * s + 6), 0, 6.283);
        ctx.stroke();
        ctx.restore();
      }
      ctx.font = "700 13px " + FONT.d;
      ctx.fillStyle = rgb(C["ink-soft"]);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      halo(
        ctx,
        o.name + (o.core === c.i ? ", " + fmtPop(o.P) : ""),
        (o.cx + dx) * s,
        (o.cy + dy) * s,
      );
    });
    const rw = Math.max(1.6, s * 0.75),
      rp = (pts) => {
        ctx.beginPath();
        pts.forEach((p, i) => {
          i ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s);
        });
        ctx.stroke();
      };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = rgb(C["c-road"], 0.85);
    ctx.lineWidth = rw + 1.6;
    c.roads.forEach(rp);
    ctx.strokeStyle = rgb(C["c-roadfill"]);
    ctx.lineWidth = rw;
    c.roads.forEach(rp);
    c.rails.forEach((p) =>
      railLine(
        ctx,
        p[0][0] * s,
        p[0][1] * s,
        p[1][0] * s,
        p[1][1] * s,
        Math.max(2, s * 0.5),
        false,
      ),
    );
    if (c.station && c.rails.length) {
      const p = c.rails[0],
        ax = p[0][0],
        ay = p[0][1],
        dx = p[1][0] - ax,
        dy = p[1][1] - ay,
        L = Math.hypot(dx, dy) || 1,
        t = clamp(((c.cx - ax) * dx + (c.cy - ay) * dy) / (L * L), 0, 1),
        sx = ax + dx * t,
        sy = ay + dy * t,
        len = 2 + c.station * 1.4,
        wd = 1 + c.station * 0.45;
      ctx.save();
      ctx.translate(sx * s, sy * s);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = rgb(C.ink);
      ctx.fillRect((-len * s) / 2, (-wd * s) / 2 - 2, len * s, wd * s + 4);
      ctx.fillStyle = rgb(C["c-roadfill"]);
      ctx.fillRect((-len * s) / 2 + 1.5, (-wd * s) / 2 - 0.5, len * s - 3, wd * s + 1);
      ctx.restore();
    }
    if (c.rw) {
      const L = 6,
        ax = c.rw.x - Math.cos(c.rw.th) * L,
        ay = c.rw.y - Math.sin(c.rw.th) * L,
        bx = c.rw.x + Math.cos(c.rw.th) * L,
        by = c.rw.y + Math.sin(c.rw.th) * L;
      ctx.save();
      ctx.lineCap = "butt";
      ctx.strokeStyle = rgb(C["c-air"]);
      ctx.lineWidth = Math.max(4, s * 1.6);
      ctx.beginPath();
      ctx.moveTo(ax * s, ay * s);
      ctx.lineTo(bx * s, by * s);
      ctx.stroke();
      ctx.strokeStyle = rgb(C.paper);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ax * s, ay * s);
      ctx.lineTo(bx * s, by * s);
      ctx.stroke();
      ctx.restore();
      const tx = c.rw.x + Math.cos(c.rw.th + Math.PI / 2) * 3,
        ty = c.rw.y + Math.sin(c.rw.th + Math.PI / 2) * 3;
      ctx.fillStyle = rgb(C["c-air"]);
      ctx.fillRect(tx * s - s, ty * s - s, 2 * s, 2 * s);
    }
    drawCityOverlays(ctx, c, s);
    ctx.restore();
    const km = [1, 2, 5].filter((k) => (k / CELLKM) * s <= 150).pop() || 1,
      bar = (km / CELLKM) * s,
      bx = 12,
      by = h - 14;
    ctx.fillStyle = rgb(C["c-ground"], 0.85);
    ctx.fillRect(bx - 6, by - 18, bar + 44, 26);
    {
      const f = (v) => (v * CELLKM).toFixed(v * CELLKM < 10 ? 1 : 0).replace(".", ",");
      $("#cityScale").textContent =
        "Показано " +
        f(w / s) +
        " × " +
        f(h / s) +
        " км. Колесо мыши меняет масштаб, перетаскивание двигает план. Соседние города видны полупрозрачно, земля между центрами делится пополам.";
    }
    ctx.strokeStyle = rgb(C.ink);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + bar, by);
    ctx.lineTo(bx + bar, by - 4);
    ctx.stroke();
    ctx.fillStyle = rgb(C.ink);
    ctx.font = "11.5px " + FONT.m;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(km + " км", bx + bar + 6, by + 1);
  }
  if (!renaming)
    $("#hCity").textContent = c.name + (c.govc ? (S.planet ? ", столица" : ", центр области") : "");
  $("#spec").textContent = c.spec;
  drawAirRoutes(c);
  const stats = [
    ["Жители", fmtPop(c.P)],
    ["Сельская округа", fmtPop(c.R) + ", сёл " + villages(c).length],
    ["Застроено", c.area.toFixed(1).replace(".", ",") + " км²"],
    ["Загрузка жилья", Math.round((c.P / c.H) * 100) + "%"],
    ["Ввод за год", c.lastBuild ? "на " + fmtPop(c.lastBuild) : "нет"],
    [
      "Медицина",
      Math.round(c.health * 100) + "%, " + fmtPop(c.healthSrv) + " из " + fmtPop(c.healthPop),
    ],
    ["Образование", Math.round(c.edu * 100) + "%, " + (c.uni ? UNI[c.uni] : "вуза нет")],
    [
      "Агломерация",
      c.core >= 0
        ? "входит в «" + S.cities[c.core].name + "»"
        : c.sats && c.sats.length
          ? c.sats.length +
            " " +
            plural(c.sats.length, "спутник", "спутника", "спутников") +
            ", всего " +
            fmtPop(c.PA)
          : "нет",
    ],
    ["Земля в центре", "≈ " + fmtRub(landBase(c))],
    [S.planet ? "До столицы" : "До центра области", c.govc ? "–" : fmtT(TT[capIdx()][S.sel])],
    [
      "Метро",
      c.metro.length ? stations(c) + " ст., охват " + Math.round(c.metroCov * 100) + "%" : "нет",
    ],
    [
      "Аэропорт",
      c.air
        ? "уровень " +
          (c.airLevel || 1) +
          " · " +
          airportLevelText(c.airLevel || 1) +
          " пассажиров/год · загрузка " +
          Math.round(c.paxLoad * 100) +
          "%"
        : "нет",
    ],
    [
      "Морской порт",
      portLevel(c, "sea")
        ? "уровень " +
          portLevelName(portLevel(c, "sea")) +
          " · " +
          fmtCargoTonnes(portCapacity(c, "sea")) +
          "/год"
        : "нет",
    ],
    [
      "Речной порт",
      portLevel(c, "river")
        ? "уровень " +
          portLevelName(portLevel(c, "river")) +
          " · " +
          fmtCargoTonnes(portCapacity(c, "river")) +
          "/год"
        : "нет",
    ],
  ];
  $("#cstats").innerHTML = stats
    .map((x) => '<div><span class="label">' + x[0] + "</span><b>" + x[1] + "</b></div>")
    .join("");
  drawEcon(c);
  drawActs(c);
  drawProd(c);
  drawMetroBox(pc);
  drawClark(c);
  $("#openPlan").textContent =
    pc.sats && pc.sats.length ? "Открыть план агломерации" : "Открыть план города";
  {
    const bn = $("#bizNote");
    if (bn) bn.textContent = "2 млрд за квартал 450 × 450 м: офисы, торговля, управление.";
  }
}
function drawEcon(c) {
  const J = Math.max(c.J, 1);
  const bar = SECT.map(
    (s) =>
      '<i style="width:' +
      ((c.jobs[s.k] / J) * 100).toFixed(2) +
      "%;background:var(--s-" +
      s.k +
      ')" title="' +
      s.t +
      '"></i>',
  ).join("");
  const rows = SECT.filter((s) => c.firms[s.k] >= 0.5)
    .map(
      (s) =>
        '<i style="background:var(--s-' +
        s.k +
        ')"></i><span>' +
        s.t +
        '</span><span class="n">' +
        fmtN(c.firms[s.k]) +
        '</span><span class="n">' +
        fmtPop(c.jobs[s.k]) +
        "</span>",
    )
    .join("");
  const tot = SECT.reduce((a, s) => a + c.firms[s.k], 0);
  $("#econ").innerHTML =
    '<div class="ebar">' +
    bar +
    '</div><div class="etab"><span></span><span class="h">отрасль</span><span class="h n">фирм</span><span class="h n">мест</span>' +
    rows +
    '<span></span><span><b>Всего</b></span><span class="n"><b>' +
    fmtN(tot) +
    '</b></span><span class="n"><b>' +
    fmtPop(c.J) +
    "</b></span></div>";
}
function actDesc(c, k, a) {
  if (k.startsWith("pl_")) {
    const q = k.slice(3);
    return PLANT[q].d.replace(
      /\d+ МВт/,
      Math.round(plantMW(Object.assign({}, c, { pw: { [q]: 1 } }), q)) + " МВт",
    );
  }
  if (k === "hosp") return "на 60 тыс., сейчас обеспечено " + Math.round(c.health * 100) + "%";
  if (k === "uni")
    return c.uni
      ? c.uni >= 5
        ? UNI[5]
        : UNI[c.uni] + " → " + UNI[c.uni + 1]
      : "открыть: " + UNI[1];
  if (k === "seaPort")
    return "доступ к морю · до " + fmtCargoTonnes(PORT_CAPACITY.sea[1]) + " груза в год";
  if (k === "riverPort")
    return "доступ к реке · до " + fmtCargoTonnes(PORT_CAPACITY.river[1]) + " груза в год";
  if (k === "seaPortUpgrade") {
    const n = portLevel(c, "sea") + 1;
    return (
      "уровень " +
      portLevelName(n) +
      " · до " +
      fmtCargoTonnes(PORT_CAPACITY.sea[n]) +
      " груза в год"
    );
  }
  if (k === "riverPortUpgrade") {
    const n = portLevel(c, "river") + 1;
    return (
      "уровень " +
      portLevelName(n) +
      " · до " +
      fmtCargoTonnes(PORT_CAPACITY.river[n]) +
      " груза в год"
    );
  }
  if (k === "air") return "код и название аэропорта задаются в разделе «Авиасообщение»";
  if (k === "airUpgrade") {
    const n = Math.min(10, (c.airLevel || 1) + 1);
    return "уровень " + n + " · до " + airportLevelText(n) + " пассажиров в год";
  }
  if (k === "station")
    return c.station
      ? c.station >= 5
        ? ST[5]
        : ST[c.station] + " → " + ST[c.station + 1]
      : "появится с первой ж/д";
  if (k === "govc" && !c.govc) {
    const o = S.cities.find((o) => o.govc);
    return o ? "перенести сюда из города " + o.name : a.d;
  }
  return a.d;
}
function actCount(c, k) {
  if (k.startsWith("pl_")) return (c.pw && c.pw[k.slice(3)]) || 0;
  if (k === "lc") return c.lc || 0;
  if (k === "station") return c.station || 0;
  if (k === "seaPort") return portLevel(c, "sea") ? portLevelName(portLevel(c, "sea")) : 0;
  if (k === "riverPort") return portLevel(c, "river") ? portLevelName(portLevel(c, "river")) : 0;
  if (k === "air") return c.air ? "уровень " + (c.airLevel || 1) : 0;
  if (k === "airUpgrade") return c.air ? "уровень " + (c.airLevel || 1) : 0;
  if (ACT[k].unique) return 0;
  return k === "hosp"
    ? c.hosp
    : k === "uni"
      ? c.uni
      : k === "mus"
        ? c.mus
        : k === "park"
          ? c.park
          : k === "tech"
            ? c.tech
            : k === "dep"
              ? S.T.deps.filter((d) => d.dev === c.i).length
              : k === "mline"
                ? c.metro.length
                : k === "mext"
                  ? stations(c)
                  : 0;
}
function drawActs(c) {
  const el = $("#acts");
  const html = Object.keys(ACT)
    .map((k) => {
      const a = ACT[k],
        why = canAct(c, k),
        n = actCount(c, k);
      return (
        '<button type="button" class="act" data-act="' +
        k +
        '"' +
        (why ? " disabled" : "") +
        "><b>" +
        a.t +
        (n ? " · " + n : "") +
        "</b><span>" +
        (why && why !== "не хватает денег" ? why : actDesc(c, k, a)) +
        '</span><span class="cost">' +
        fmtM(costOf(c, k)) +
        "</span></button>"
      );
    })
    .join("");
  if (el.dataset.h !== html) {
    el.innerHTML = html;
    el.dataset.h = html;
  }
}
function drawLinks(c) {
  const sel = $("#roadTo");
  const n = S.cities.length;
  const opts = S.cities
    .filter((o) => o.i !== c.i)
    .map((o) => ({ key: o.i, o, km: dist(o, c) }))
    .concat(S.ext.map((e) => ({ key: "e" + e.k, o: e, km: Math.hypot(c.x - e.gx, c.y - e.gy) })));
  opts.sort((a, b) => a.km - b.km);
  const keep = opts.some((x) => x.key === roadSel) ? roadSel : opts[0] && opts[0].key;
  const html = opts
    .map((x) => {
      const rr = linkBetween(c.i, x.key, "road"),
        rl = linkBetween(c.i, x.key, "rail"),
        t = TT[c.i][x.o.ext ? n + x.o.k : x.o.i];
      const ex = [];
      if (rr) ex.push(rr.fast ? "скоростная трасса" : "дорога");
      if (rl) ex.push(rl.fast ? "скоростная ж/д" : "ж/д");
      return (
        '<option value="' +
        x.key +
        '"' +
        (x.key === keep ? " selected" : "") +
        ">" +
        esc(x.o.name) +
        (x.o.ext ? ", до границы " : ", ") +
        Math.round(x.km) +
        " км · сейчас " +
        fmtT(t) +
        (ex.length ? " · " + ex.join(", ") : "") +
        "</option>"
      );
    })
    .join("");
  if (document.activeElement !== sel && sel.dataset.h !== html) {
    sel.innerHTML = html;
    sel.dataset.h = html;
  }
  setRoadSel(keep);
  updateLinkBtn(c);
}
function updateLinkBtn(c) {
  const b = $("#roadBtn"),
    j = roadSel;
  if (j == null) return;
  const r = linkBetween(c.i, j, mode);
  const rail = mode === "rail";
  if (r && r.fast) {
    b.textContent = rail ? "Уже скоростная ж/д" : "Уже скоростная";
    b.disabled = true;
  } else {
    const cost = linkCost(c.i, j, mode, !!r);
    b.textContent =
      (r
        ? rail
          ? "Скоростная ж/д · "
          : "Сделать скоростной · "
        : rail
          ? "Проложить ж/д · "
          : "Проложить дорогу · ") + fmtM(cost);
    b.disabled = S.budget < cost;
  }
  $("#roadNote").textContent =
    "«Сейчас» означает время по уже существующей сети, включая путь через другие города и авиарейсы." +
    (typeof j === "string" ? " До соседнего региона строится участок до границы." : "");
}
function drawChart() {
  const cv = $("#chart"),
    cw = cv.clientWidth || 600,
    { ctx, w, h } = fit(cv, cw < 600 ? 0.62 : 0.42),
    cs = S.cities;
  const pl = 48,
    pr = cw < 500 ? 80 : 118,
    pt = 10,
    pb = 24,
    iw = w - pl - pr,
    ih = h - pt - pb;
  ctx.fillStyle = rgb(C.paper);
  ctx.fillRect(0, 0, w, h);
  const x1 = Math.max(2056, S.year);
  let lo = 1e9,
    hi = 0;
  cs.forEach((c) =>
    c.hist.forEach((v) => {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }),
  );
  lo = Math.max(100, lo * 0.8);
  hi = hi * 1.25;
  const L0 = Math.log10(lo),
    L1 = Math.log10(hi);
  const X = (y) => pl + ((y - 2026) / (x1 - 2026)) * iw,
    Y = (v) => pt + ((L1 - Math.log10(Math.max(v, lo))) / (L1 - L0)) * ih;
  ctx.font = "11px " + FONT.m;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = [];
  for (let e = Math.floor(L0); e <= Math.ceil(L1); e++)
    [1, 3].forEach((m) => {
      const v = m * Math.pow(10, e);
      if (v >= lo && v <= hi) ticks.push(v);
    });
  ticks.forEach((v) => {
    ctx.strokeStyle = rgb(C.rule, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pl, Y(v));
    ctx.lineTo(pl + iw, Y(v));
    ctx.stroke();
    ctx.fillStyle = rgb(C["ink-soft"]);
    ctx.fillText(
      v >= 1e6 ? v / 1e6 + " млн" : v >= 1000 ? v / 1000 + " тыс" : String(v),
      pl - 6,
      Y(v),
    );
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xs = Math.max(5, niceStep(x1 - 2026, 6));
  for (let y = 2026; y <= x1; y += xs) {
    ctx.fillStyle = rgb(C["ink-soft"]);
    ctx.fillText(String(y), X(y), pt + ih + 6);
  }
  const order = cs
    .map((c) => c.i)
    .filter((i) => i !== S.sel)
    .concat([S.sel]);
  order.forEach((i) => {
    const c = cs[i],
      sel = i === S.sel;
    ctx.strokeStyle = sel ? rgb(C.accent) : rgb(C["ink-soft"], 0.4);
    ctx.lineWidth = sel ? 2.5 : 1.1;
    ctx.beginPath();
    c.hist.forEach((v, k) => {
      const px = X(c.founded + k),
        py = Y(v);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    const n = c.hist.length;
    ctx.fillStyle = sel ? rgb(C.accent) : rgb(C["ink-soft"], 0.6);
    ctx.beginPath();
    ctx.arc(X(c.founded + n - 1), Y(c.hist[n - 1]), sel ? 3.5 : 2, 0, Math.PI * 2);
    ctx.fill();
  });
  const byP = cs.slice().sort((a, b) => b.P - a.P);
  const show = [];
  [S.sel, byP[0].i, byP[byP.length - 1].i].forEach((i) => {
    if (show.indexOf(i) < 0) show.push(i);
  });
  const labs = show.map((i) => ({ i, y: Y(cs[i].P) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < labs.length; k++)
    if (labs[k].y - labs[k - 1].y < 14) labs[k].y = labs[k - 1].y + 14;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  labs.forEach((l) => {
    const c = cs[l.i],
      sel = l.i === S.sel;
    ctx.font = (sel ? "700 " : "") + "12.5px " + FONT.d;
    ctx.fillStyle = sel ? rgb(C.accent) : rgb(C["ink-soft"]);
    ctx.fillText(c.name, X(S.year) + 8, l.y);
  });
}
function niceStep(r, n) {
  const raw = Math.max(r, 1e-9) / n,
    p = Math.pow(10, Math.floor(Math.log10(raw))),
    m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function drawTable() {
  const cs = S.cities;
  $("#tbody").innerHTML = cs
    .map((c) => {
      const n = c.hist.length,
        d1 = n > 1 ? c.hist[n - 1] / c.hist[n - 2] - 1 : 0,
        o = c.P / c.H,
        f = SECT.reduce((a, s) => a + c.firms[s.k], 0);
      const cl = (v) => (v > 0.0005 ? "up" : v < -0.0005 ? "down" : "");
      return (
        '<tr data-i="' +
        c.i +
        '"' +
        (c.i === S.sel ? ' class="sel"' : "") +
        '><td class="l">' +
        esc(c.name) +
        '</td><td class="l s">' +
        c.spec +
        "</td><td>" +
        fmtPop(c.P) +
        "</td><td>" +
        fmtPop(c.R) +
        '</td><td class="' +
        cl(d1) +
        '">' +
        pct(d1) +
        "</td><td>" +
        fmtN(f) +
        "</td><td>" +
        Math.round(o * 100) +
        '%</td><td class="' +
        (c.health < 0.7 ? "down" : "") +
        '">' +
        Math.round(Math.min(c.health, 9.99) * 100) +
        "%</td><td>" +
        Math.round(c.Arel * 100) +
        "</td></tr>"
      );
    })
    .join("");
}
function drawLog() {
  $("#log").innerHTML = S.log
    .slice(0, 100)
    .map((e) => "<li><span>" + e.y + "</span><span>" + esc(e.t) + "</span></li>")
    .join("");
}
function plural(n, a, b, c) {
  const m = n % 10,
    h = n % 100;
  return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c;
}
const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
export function updateGameDate() {
  if (!S) return;
  const monthIndex = clamp(S.monthIndex || 0, 0, 11),
    key = S.year + ":" + monthIndex;
  if (key === lastGameDate) return;
  setLastGameDate(key);
  $("#year").textContent = S.year;
  $("#month").textContent = MONTHS[monthIndex];
  $("#gameDate").setAttribute("aria-label", MONTHS[monthIndex] + " " + S.year);
}
export function drawKpis() {
  const cs = S.cities,
    t = cs.reduce((s, c) => s + c.P + c.R, 0) + (S.ruralPool || 0),
    f = cs.reduce((a, c) => a + SECT.reduce((b, s) => b + c.firms[s.k], 0), 0);
  updateGameDate();
  $("#kExtLabel").textContent = S.planet
    ? "сельское население · человек/год"
    : "внешняя миграция · человек/год";
  $("#kBudget").textContent = fmtM(S.budget);
  $("#kIncome").textContent =
    (S.income < 0 ? "−" : "+") + fmtM(Math.abs(S.income)) + " сальдо за год";
  $("#kTotal").textContent = fmtPop(t);
  const rur = cs.reduce((s, c) => s + c.R, 0) + (S.ruralPool || 0);
  $("#kCities").textContent =
    cs.length +
    " " +
    plural(cs.length, "город", "города", "городов") +
    ", село " +
    Math.round((rur / Math.max(t, 1)) * 100) +
    "%";
  const x = Math.round((S.extNet || 0) + (S.ruralFlow || 0));
  const ke = $("#kExt");
  ke.textContent = (x > 0 ? "+" : "") + fmtN(x);
  ke.className = x > 0 ? "up" : x < 0 ? "down" : "";
  $("#kFirms").textContent = fmtN(f);
  if (S.en) {
    const e = S.en;
    $("#kEn").textContent = fmtN(e.D) + " / " + fmtN(e.cap) + " МВт";
    const k2 = $("#kEn2");
    k2.textContent =
      e.def > 0.005
        ? "дефицит " + Math.round(e.def * 100) + "%"
        : e.imp > 0.5
          ? "покупаем " + fmtN(e.imp) + " МВт"
          : "резерв " + Math.round((e.cap / Math.max(1, e.D) - 1) * 100) + "%";
    k2.className = e.def > 0.005 || e.imp > 0.5 ? "down" : "";
  }
  $("#step").disabled = $("#play").disabled = S.year >= YMAX;
}
const FIN_IN_LABELS = {
    population: "Поступления с населения",
    enterprise: "Налог на прибыль и добычу",
    energy: "Энергетика",
    trade: "Внешняя торговля",
  },
  FIN_OUT_LABELS = {
    road_local: "Строительство местных дорог",
    road_regional: "Строительство региональных дорог",
    road_national: "Строительство национальных дорог",
    road_international: "Строительство международных дорог",
    roadUpgrade: "Повышение класса и скорости дорог",
    roadMaintain_local: "Содержание местных дорог",
    roadMaintain_regional: "Содержание региональных дорог",
    roadMaintain_national: "Содержание национальных дорог",
    roadMaintain_international: "Содержание международных дорог",
    railBuild: "Строительство ж/д",
    railMaintain: "Содержание ж/д",
    aviation: "Новые авиалинии и увеличение частоты",
    airportBuild: "Аэропорты и рост их пропускной способности",
    airOperations: "Работа аэропортов и рейсов",
    ports: "Морские и речные порты",
    cargoBuild: "Строительство грузовых маршрутов",
    cargoOperations: "Работа грузовых маршрутов",
    territory: "Содержание присоединённых регионов",
    metro: "Метро",
    parks: "Парки и заповедники",
    industry: "Производственные предприятия и технопарки",
    logistics: "Логистические комплексы",
    health: "Больницы",
    education: "Вузы",
    culture: "Музеи и театры",
    administration: "Управление и госучреждения",
    research: "Наукограды",
    energyBuild: "Строительство электростанций",
    energyGeneration: "Выработка электроэнергии",
    businessDistrict: "Деловые кварталы",
    construction: "Городская и прочая стройка",
    energy: "Дефицит энергетики",
    trade: "Дефицит внешней торговли",
  };
function financeTable(title, items, labels, kind) {
  const rows = Object.keys(labels)
    .filter((k) => (items && items[k]) > 0.0001)
    .map(
      (k) =>
        '<tr><td class="l">' +
        labels[k] +
        '</td><td class="n ' +
        kind +
        '">' +
        (kind === "down" ? "−" : "+") +
        fmtM(items[k]) +
        "</td></tr>",
    )
    .join("");
  return (
    "<h3>" +
    title +
    "</h3>" +
    (rows
      ? '<div class="tablewrap"><table class="dt"><tbody>' + rows + "</tbody></table></div>"
      : '<p class="note">Пока нет операций.</p>')
  );
}
export function drawBudget() {
  const box = $("#budgetBody"),
    sheet = $("#budgetSheetBody");
  if (!box && !sheet) return;
  const book = financeBook(),
    last = book.last,
    cur = book.current,
    tot = (o) => Object.values<any>(o || {}).reduce((a, v) => a + (Number(v) || 0), 0),
    income = tot(last && last.income),
    expense = tot(last && last.expense),
    net = income - expense,
    curExpense = tot(cur.expense);
  let html = "",
    full = "";
  if (last) {
    html +=
      '<p class="note">Итоги за ' +
      last.year +
      ': поступило <b class="up">' +
      fmtM(income) +
      '</b>, израсходовано <b class="down">' +
      fmtM(expense) +
      "</b>, сальдо " +
      (net < 0 ? "−" : "+") +
      fmtM(Math.abs(net)) +
      ".</p>" +
      financeTable("Доходы", last.income, FIN_IN_LABELS, "up") +
      financeTable("Расходы", last.expense, FIN_OUT_LABELS, "down");
    full =
      '<p class="note">Подробная ведомость за завершённый игровой год ' +
      last.year +
      '.</p><div class="budget-summary"><div><span class="label">Остаток средств</span><b>' +
      fmtM(S.budget) +
      '</b></div><div><span class="label">Доходы за ' +
      last.year +
      '</span><b class="up">+' +
      fmtM(income) +
      '</b></div><div><span class="label">Сальдо за год</span><b class="' +
      (net < 0 ? "down" : "up") +
      '">' +
      (net < 0 ? "−" : "+") +
      fmtM(Math.abs(net)) +
      '</b></div></div><div class="budget-columns">' +
      financeTable("Доходы · " + last.year, last.income, FIN_IN_LABELS, "up") +
      financeTable("Расходы · " + last.year, last.expense, FIN_OUT_LABELS, "down") +
      "</div>";
  } else {
    html +=
      '<p class="note">Первый годовой отчёт появится после перехода года. Все стройки уже отражаются в текущих расходах.</p>';
    full =
      '<p class="note">Первый годовой отчёт появится после перехода игрового года. До этого здесь видны доступные средства и уже оплаченные стройки.</p><div class="budget-summary"><div><span class="label">Остаток средств</span><b>' +
      fmtM(S.budget) +
      '</b></div><div><span class="label">Доходы</span><b>ожидаются</b></div><div><span class="label">Расходы текущего года</span><b class="down">−' +
      fmtM(curExpense) +
      "</b></div></div>";
  }
  html +=
    '<details class="fold"><summary>Текущий период · ' +
    cur.year +
    " · уже оплачено</summary>" +
    financeTable("Расходы с начала года", cur.expense, FIN_OUT_LABELS, "down") +
    "</details>";
  full +=
    '<div class="budget-current"><h3>Текущий год · ' +
    cur.year +
    '</h3><p class="note">Оплачено с начала года: <b class="down">−' +
    fmtM(curExpense) +
    "</b>. Доходы и ежегодное содержание инфраструктуры будут сведены при переходе года.</p>" +
    financeTable("Уже оплаченные расходы", cur.expense, FIN_OUT_LABELS, "down") +
    "</div>";
  const history = (book.history || []).slice(-12).reverse();
  if (history.length)
    full +=
      '<div class="budget-current"><h3>История · последние ' +
      history.length +
      ' лет</h3><div class="tablewrap"><table class="dt"><thead><tr><th>Год</th><th>Доходы</th><th>Расходы</th><th>Сальдо</th></tr></thead><tbody>' +
      history
        .map((y) => {
          const inc = tot(y.income),
            out = tot(y.expense),
            balance = inc - out;
          return (
            "<tr><td>" +
            y.year +
            '</td><td class="up">+' +
            fmtM(inc) +
            '</td><td class="down">−' +
            fmtM(out) +
            '</td><td class="' +
            (balance < 0 ? "down" : "up") +
            '">' +
            (balance < 0 ? "−" : "+") +
            fmtM(Math.abs(balance)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div></div>";
  if (box && box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
  if (sheet && sheet.dataset.h !== full) {
    sheet.innerHTML = full;
    sheet.dataset.h = full;
  }
  $("#budgetDialogTitle").textContent = last
    ? "Государственный бюджет · " + last.year
    : "Государственный бюджет · " + cur.year;
}
function drawAirRanking() {
  const box = $("#airRankingBody");
  if (!box) return;
  const routes = (S.airRoutes || [])
      .map((r) => ({ r, st: airRouteStats(r) }))
      .filter((x) => x.st && S.cities[x.r.a]?.air && S.cities[x.r.b]?.air)
      .sort((a, b) => b.st.pax - a.st.pax || b.st.fpm - a.st.fpm),
    shown = routes.slice(0, 50);
  let html = "";
  if (!routes.length)
    html =
      '<p class="note">Авиамаршрутов пока нет. Рейтинг появится после открытия первого направления.</p>';
  else
    html =
      '<p class="note">Топ-50 из ' +
      routes.length +
      ' направлений · пассажирские поездки за год, расписание за месяц. Спрос и фактическая перевозка показаны отдельно.</p><div class="tablewrap air-ranking"><table class="dt"><thead><tr><th>№</th><th class="l">Направление</th><th>Спрос, поездок/год</th><th>Перевезено, поездок/год</th><th>Рейсов/мес.</th><th>Заполнение</th></tr></thead><tbody>' +
      shown
        .map((x, i) => {
          const a = S.cities[x.r.a],
            b = S.cities[x.r.b],
            st = x.st;
          return (
            "<tr><td>" +
            (i + 1) +
            '</td><td class="l">' +
            esc(a.name) +
            " ↔ " +
            esc(b.name) +
            "</td><td>" +
            fmtN(st.demand) +
            "</td><td>" +
            fmtN(st.pax) +
            "</td><td>" +
            st.fpm +
            "</td><td>" +
            Math.round(st.load * 100) +
            "%</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
export function render() {
  drawKpis();
  drawBudget();
  drawAirRanking();
  drawCargoRoutes();
  drawRegion();
  drawCity();
  if (TAB === "region") drawChart();
  drawTable();
  drawLog();
  drawDist();
  drawTerritory();
  drawZoneTable();
  drawMarket();
  if (TAB === "mkt") {
    drawEnergy();
    drawFirms();
    drawChains();
    drawDeps();
  }
  drawNb();
  drawLegend();
  toolButtons();
  onRender();
  $("#regionTitle").textContent = regionName();
  document.title = regionName();
}

export function setupDraw() {
  $("#airportIdentity").addEventListener("click", (e) => {
    if (!e.target.closest("[data-airport-save]")) return;
    const c = S.cities[S.sel],
      name = $("#airportNameInput").value.trim(),
      code = $("#airportCodeInput").value.trim().toUpperCase(),
      status = $("#airportIdentity [role=status]");
    if (!c || !c.air) return;
    if (!name) {
      status.textContent = "Введите название аэропорта.";
      return;
    }
    if (!/^[A-Z]{3}$/.test(code)) {
      status.textContent = "Код должен состоять ровно из трёх латинских букв.";
      return;
    }
    if (S.cities.some((o) => o !== c && o.air && o.airportCode === code)) {
      status.textContent = "Этот код уже занят другим аэропортом.";
      return;
    }
    c.airportName = name;
    c.airportCode = code;
    logEv("Аэропорт города " + c.name + " переименован: " + name + " (" + code + ")");
    boxReset();
    evaluate();
    render();
    function boxReset() {
      $("#airportIdentity").dataset.sig = "";
    }
  });
}

// Новая плитка рельефа готова: перерисовываем карту не чаще раза за кадр.
let reliefRedraw = 0;
setReliefUpdateHandler(() => {
  if (reliefRedraw) return;
  reliefRedraw = requestAnimationFrame(() => {
    reliefRedraw = 0;
    if (S && VIEW === "region") drawRegion();
  });
});
