import { rgb } from "./colors";
import { RH, RW } from "./config";
import { storeAppPrefs } from "./controls";
import { drawGeoNameOverlay, drawRegion, drawResourceOverlay } from "./draw";
import { drawLegend } from "./layers";
import { C, S, rng } from "./state";
import { forestVal, riverDist, soilVal } from "./terrain";
import { $, mulberry32 } from "./util";
import { isIceAt, seaD } from "./worldgen";

export const VIL = { show: true };
export function makeVillages(c) {
  const sites = [];
  let g = 0;
  while (sites.length < 12 && g++ < 400) {
    const a = rng() * Math.PI * 2,
      r = 4 + rng() * 12,
      x = c.x + Math.cos(a) * r,
      y = c.y + Math.sin(a) * r;
    if (x < 3 || y < 3 || x > RW - 3 || y > RH - 3 || riverDist(x, y) < 0.6) continue;
    if (S.cities.some((o) => o !== c && Math.hypot(o.x - x, o.y - y) < 4)) continue;
    if (sites.some((q) => Math.hypot(q.x - x, q.y - y) < 2.5)) continue;
    const sv = soilVal(x, y),
      fv = forestVal(x, y);
    sites.push({
      x,
      y,
      w:
        0.4 +
        (sv > 0.55 ? 1.2 : 0) +
        (fv > 0.6 ? 0.3 : 0) +
        (riverDist(x, y) < 3 ? 0.4 : 0) +
        rng() * 0.5,
    });
  }
  sites.sort((a, b) => b.w - a.w);
  c.vsites = sites;
}
export function makeRuralSites(seed, pop) {
  const rr = mulberry32((seed ^ 0x319be7a1) >>> 0),
    a = S.adminMap,
    sites = [];
  if (a) {
    for (const d of S.districts || []) {
      const q = a.points[d.id],
        x = (((q % a.W) + 0.5) * RW) / a.W,
        y = ((Math.floor(q / a.W) + 0.5) * RH) / a.H;
      sites.push({ x, y, p: Math.max(0, d.ruralPop || 0), districtId: d.id });
    }
  }
  const sum = sites.reduce((n, v) => n + v.p, 0);
  if (sum && pop > 0) sites.forEach((v) => (v.p *= pop / sum));
  if (!sites.length && pop > 0) {
    let tries = 0;
    while (sites.length < 24 && tries++ < 5000) {
      const x = rr() * RW,
        y = RH * 0.12 + rr() * RH * 0.76;
      if ((S.T.sea && seaD(x, y) < 4) || isIceAt(x, y)) continue;
      sites.push({ x, y, p: 0 });
    }
    const each = sites.length ? pop / sites.length : 0;
    sites.forEach((v) => (v.p = each));
  }
  S.ruralSites = sites;
}
export function ruralTarget(c) {
  return c.soilSh * 9000 + c.forestSh * 2500 + 600 + 0.05 * c.P;
}
export function villages(c) {
  const n = Math.min(c.vsites.length, Math.max(0, Math.round(c.R / 450)));
  if (!n) return [];
  const ws = c.vsites.slice(0, n),
    tw = ws.reduce((a, v) => a + v.w, 0);
  return ws.map((v) => ({ x: v.x, y: v.y, p: (c.R * v.w) / tw }));
}
export function villageBoxes(s) {
  const out = [];
  S.cities.forEach((c) =>
    villages(c).forEach((v) => {
      const z = v.p > 1500 ? 3 : 2;
      out.push({ x: v.x * s - z, y: v.y * s - z, w: 2 * z, h: 2 * z });
    }),
  );
  return out;
}
export function drawVillages(ctx, s) {
  if (!VIL.show) return;
  S.ruralSites &&
    S.ruralSites.forEach((v) => {
      if (v.p > 100) {
        ctx.fillStyle = rgb(C["s-agro"], 0.72);
        const z = v.p > 3000 ? 2.1 : 1.3;
        ctx.fillRect(v.x * s - z, v.y * s - z, z * 2, z * 2);
      }
    });
  ctx.fillStyle = rgb(C["ink-soft"]);
  S.cities.forEach((c) =>
    villages(c).forEach((v) => {
      const z = v.p > 1500 ? 3 : v.p > 700 ? 2.3 : 1.7;
      ctx.fillRect(v.x * s - z, v.y * s - z, 2 * z, 2 * z);
    }),
  );
}

export function setupVillages() {
  $("#vilChk").addEventListener("change", (e) => {
    VIL.show = e.target.checked;
    drawRegion();
  });
  $("#geoNamesChk").addEventListener("change", () => {
    storeAppPrefs();
    drawGeoNameOverlay();
    drawLegend();
  });
  $("#resourcesChk").addEventListener("change", () => {
    storeAppPrefs();
    drawResourceOverlay();
    drawLegend();
  });
}
