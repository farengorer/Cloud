import { hex, rgb } from "./colors";
import { P, RH, RW } from "./config";
import { cityVisibleAtTier, districtCapitalIds, drawViewportImage, mapScaleTier } from "./draw";
import { S, TAB, TT, ZONE } from "./state";
import { $, esc, fmtPop } from "./util";

const ZCOL = [
  "#3D7EA6",
  "#C0703A",
  "#4F8F3A",
  "#93408A",
  "#2E8F86",
  "#B0952F",
  "#6656B0",
  "#B04A5E",
  "#5A7D99",
  "#8C6E3C",
];
function zoneCompute() {
  const cs = S.cities,
    n = cs.length,
    key =
      S.year +
      "|" +
      n +
      "|" +
      S.roads.length +
      "|" +
      S.roads.filter((r) => r.fast).length +
      "|" +
      P.speed +
      "|" +
      cs.map((c) => c.metro.length).join("") +
      "|" +
      S.regions.map((d) => d.center + ":" + d.cities.join(",")).join(";");
  const dOf = cs.map(() => null);
  S.regions.forEach((d) => {
    d.cities.forEach((i) => {
      dOf[i] = d;
    });
  });
  const boost = (i, j) => (dOf[i] && dOf[i].center === j ? 3 : 1);
  if (ZONE.key === key && ZONE.img) return;
  ZONE.key = key;
  const parent = cs.map((c, i) => {
    let bj = -1,
      bv = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const v = cs[j].P * Math.exp(-TT[i][j] / 45) * boost(i, j);
      if (v > bv) {
        bv = v;
        bj = j;
      }
    }
    return bj >= 0 && (cs[bj].P > c.P || boost(i, bj) > 1) ? bj : -1;
  });
  const root = cs.map((c, i) => {
    let r = i,
      g = 0;
    while (parent[r] >= 0 && g++ < 50) r = parent[r];
    return r;
  });
  const roots = [...new Set(root)].sort((a, b) => cs[b].P - cs[a].P);
  const col = {};
  roots.forEach((r, k) => (col[r] = hex(ZCOL[k % ZCOL.length])));
  const W = 80,
    H = 60,
    cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const wx = ((gx + 0.5) * RW) / W,
        wy = ((gy + 0.5) * RH) / H;
      const near = cs
        .map((c, k) => ({ k, d: Math.hypot(c.x - wx, c.y - wy) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4);
      let bj = 0,
        bv = -1;
      for (let j = 0; j < n; j++) {
        let t = 1e9;
        near.forEach((o) => {
          const tl = (75 * o.d) / 30 + 5;
          const v = o.k === j ? tl : tl + TT[o.k][j];
          if (v < t) t = v;
        });
        const v =
          cs[j].P * Math.exp(-t / 45) * (dOf[near[0].k] && dOf[near[0].k].center === j ? 2 : 1);
        if (v > bv) {
          bv = v;
          bj = j;
        }
      }
      const cc = col[root[bj]],
        p = (gy * W + gx) * 4;
      im.data[p] = cc[0];
      im.data[p + 1] = cc[1];
      im.data[p + 2] = cc[2];
      im.data[p + 3] = 255;
    }
  x.putImageData(im, 0, 0);
  ZONE.img = cv;
  ZONE.roots = roots;
  ZONE.parent = parent;
  ZONE.root = root;
  ZONE.col = col;
}
export function drawZones(
  ctx,
  s,
  shift = 0,
  w = 0,
  h = 0,
  OX = 0,
  OY = 0,
  tier = mapScaleTier(),
  centers = districtCapitalIds(),
) {
  if (!ZONE.show) return;
  zoneCompute();
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.imageSmoothingEnabled = true;
  drawViewportImage(ctx, ZONE.img, s, shift, w, h, OX, OY);
  ctx.restore();
  const cs = S.cities;
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  cs.forEach((c, i) => {
    const p = ZONE.parent[i];
    if (p < 0 || !cityVisibleAtTier(c, tier, centers) || !cityVisibleAtTier(cs[p], tier, centers))
      return;
    ctx.strokeStyle = rgb(ZONE.col[ZONE.root[i]]);
    ctx.beginPath();
    ctx.moveTo(c.x * s, c.y * s);
    ctx.lineTo(cs[p].x * s, cs[p].y * s);
    ctx.stroke();
  });
  ctx.restore();
}
export function drawZoneTable() {
  if (TAB !== "region") return;
  zoneCompute();
  const cs = S.cities;
  const html = ZONE.roots
    .map((r) => {
      const mem = cs.filter((c, i) => ZONE.root[i] === r);
      const subs = mem
        .filter((c) => c.i !== r)
        .sort((a, b) => b.P - a.P)
        .map((c) => esc(c.name));
      return (
        '<tr><td class="l" style="color:' +
        ZCOL[ZONE.roots.indexOf(r) % ZCOL.length] +
        ';font-weight:700">' +
        esc(cs[r].name) +
        "</td><td>" +
        mem.length +
        "</td><td>" +
        fmtPop(mem.reduce((a, c) => a + c.P, 0)) +
        "</td><td>" +
        fmtPop(mem.reduce((a, c) => a + c.R, 0)) +
        '</td><td class="l s" style="white-space:normal">' +
        (subs.join(", ") || "–") +
        "</td></tr>"
      );
    })
    .join("");
  const tb = $("#zbody");
  if (tb.dataset.h !== html) {
    tb.innerHTML = html;
    tb.dataset.h = html;
  }
}
