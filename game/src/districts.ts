import { ROAD_CLASS_LABELS, buildLink, linkCost, selectedRoadClass, spend } from "./actions";
import { isSat } from "./agglomerations";
import { hex, rgb } from "./colors";
import { RH, RW, SECT } from "./config";
import { RC, setFounding } from "./controls";
import {
  ROAD_CLASS_RANK,
  V,
  drawRegion,
  drawViewportImage,
  halo,
  mapScaleTier,
  radius,
  render,
  roadClass,
} from "./draw";
import {
  airRouteCost,
  airRouteStats,
  byKey,
  evaluate,
  geoXY,
  linkBetween,
  logEv,
  nearX,
  roadWaterError,
  wrapX,
} from "./model";
import {
  C,
  FONT,
  LAYER,
  S,
  ZONE,
  airDraft,
  cargoDraft,
  dPick,
  districtPopupAnchor,
  rdraw,
  rmode,
  setDPick,
  setDistrictPopupAnchor,
  setLAYER,
  setRdraw,
  setTerritoryPage,
  territoryPage,
} from "./state";
import {
  cargoRouteCost,
  cargoRouteStats,
  forestVal,
  portLevel,
  riverCargoPath,
  riverDist,
  riverPortAccess,
  seaCargoPath,
  seaPortAccess,
  settleCargoFlows,
} from "./terrain";
import { $, clamp, esc, fmtM, fmtN, fmtPop, mulberry32 } from "./util";
import { flash, setTab, toolButtons } from "./views";
import { makeRuralSites } from "./villages";
import { isIceAt, mtVal, seaD } from "./worldgen";

export const DCOL = [
  "#3D7EA6",
  "#B0673D",
  "#5E8C3D",
  "#8C3D7E",
  "#3D8C80",
  "#A6913D",
  "#6B5BA8",
  "#A64D5E",
];
function pip(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      ins = !ins;
  }
  return ins;
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a) / 2;
}
function centroid(pts) {
  let x = 0,
    y = 0;
  pts.forEach((p) => {
    x += p[0];
    y += p[1];
  });
  return [x / pts.length, y / pts.length];
}
function startDistrict() {}
export function addVertex(..._args: any[]) {}
function closeDistrict() {}
export function drawEditPoly(..._args: any[]) {}
export function drawPolys(ctx, list, s) {
  list.forEach((d) => {
    const col = hex(d.color);
    ctx.save();
    ctx.fillStyle = rgb(col, 0.13);
    ctx.strokeStyle = rgb(col, 0.9);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    d.pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}
export function drawPolyLabels(ctx, list, s) {
  list.forEach((d) => {
    const [x, y] = centroid(d.pts);
    ctx.font = "italic 700 12.5px " + FONT.b;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgb(hex(d.color));
    halo(ctx, d.name, x * s, y * s);
  });
}
/* districts are built from cities; territory around each city goes to its district */
export const DIST = {
  key: "",
  img: null,
  cnt: [],
  area: [],
  cell: null,
  W: 0,
  H: 0,
  cellA: 4,
  nations: [],
};
const NATION = { key: "", cell: null, stats: [] };
export function countryAt(x, y) {
  return 0;
}
function landComponents() {
  if (S.landComp) return S.landComp;
  const W = 720,
    H = 360,
    N = W * H,
    comp = new Int32Array(N).fill(-1),
    queue = new Int32Array(N);
  let nc = 0;
  for (let k = 0; k < N; k++) {
    const gx = k % W,
      gy = (k / W) | 0,
      wx = ((gx + 0.5) * RW) / W,
      wy = ((gy + 0.5) * RH) / H;
    if (comp[k] >= 0 || (S.T.sea && seaD(wx, wy) < 0)) continue;
    let h = 0,
      t = 0;
    queue[t++] = k;
    comp[k] = nc;
    while (h < t) {
      const q = queue[h++],
        qx = q % W,
        qy = (q / W) | 0,
        ns = [
          qy * W + ((qx + W - 1) % W),
          qy * W + ((qx + 1) % W),
          qy > 0 ? q - W : -1,
          qy < H - 1 ? q + W : -1,
        ];
      for (const z of ns) {
        if (z < 0 || comp[z] >= 0) continue;
        const zx = z % W,
          zy = (z / W) | 0;
        if (S.T.sea && seaD(((zx + 0.5) * RW) / W, ((zy + 0.5) * RH) / H) < 0) continue;
        comp[z] = nc;
        queue[t++] = z;
      }
    }
    nc++;
  }
  S.landComp = comp;
  return comp;
}
function nationCompute() {
  const key =
    S.seed +
    "|" +
    (S.cities[0] ? S.cities[0].x + ":" + S.cities[0].y : "-") +
    "|" +
    S.ext.map((e) => e.gx + ":" + e.gy).join(",");
  if (NATION.key === key && NATION.cell) return NATION;
  const W = 720,
    H = 360,
    comp = landComponents(),
    cell = new Uint8Array(W * H),
    stats = S.ext.map(() => ({ count: 0, sin: 0, cos: 0, y: 0 }));
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const q = gy * W + gx;
      if (comp[q] < 0) continue;
      const nation = countryAt(((gx + 0.5) * RW) / W, ((gy + 0.5) * RH) / H);
      cell[q] = nation;
      if (nation) {
        const st = stats[nation - 1],
          a = (2 * Math.PI * (gx + 0.5)) / W;
        st.count++;
        st.sin += Math.sin(a);
        st.cos += Math.cos(a);
        st.y += ((gy + 0.5) * RH) / H;
      }
    }
  NATION.key = key;
  NATION.cell = cell;
  NATION.stats = stats;
  return NATION;
}
export function makeAdminDistrictMap(seed, version = 2) {
  const legacy = version < 2,
    W = legacy ? 720 : 1440,
    H = legacy ? 360 : 720,
    N = W * H,
    rr = mulberry32((seed ^ 0x4f31c2a9) >>> 0);
  if (legacy) {
    const comp = landComponents(),
      land = [];
    for (let q = 0; q < N; q++) if (comp[q] >= 0) land.push(q);
    for (let i = land.length - 1; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [land[i], land[j]] = [land[j], land[i]];
    }
    const owner = new Uint32Array(N),
      points = [],
      seeded = new Set(),
      target = Math.min(52000, Math.max(1, Math.ceil(land.length / 2)));
    for (const q of land)
      if (!seeded.has(comp[q])) {
        seeded.add(comp[q]);
        points.push(q);
      }
    const chosen = new Set(points);
    for (const q of land)
      if (points.length < target && !chosen.has(q)) {
        chosen.add(q);
        points.push(q);
      }
    const queue = new Int32Array(land.length);
    let tail = 0;
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      owner[q] = i + 1;
      queue[tail++] = q;
    }
    let head = 0;
    while (head < tail) {
      const q = queue[head++],
        x = q % W,
        y = (q / W) | 0,
        ns = [
          y * W + ((x + W - 1) % W),
          y * W + ((x + 1 + W) % W),
          y ? q - W : -1,
          y < H - 1 ? q + W : -1,
        ],
        id = owner[q];
      for (const n of ns) {
        if (n < 0 || owner[n] || comp[n] !== comp[q]) continue;
        owner[n] = id;
        queue[tail++] = n;
      }
    }
    const sizes = new Uint32Array(points.length),
      area = new Float64Array(points.length);
    for (let q = 0; q < N; q++) {
      const id = owner[q] - 1;
      if (id < 0) continue;
      sizes[id]++;
      const lat = ((Math.floor(q / W) + 0.5) / H - 0.5) * Math.PI;
      area[id] += (RW / W) * (RH / H) * Math.max(0.08, Math.cos(lat));
    }
    S.adminMap = {
      version: 1,
      W,
      H,
      owner,
      component: comp,
      points,
      sizes,
      area,
      count: points.length,
    };
    S.districts = [];
    rebuildDistrictLookup();
    return;
  }
  const landMask = new Uint8Array(N);
  let landCount = 0;
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const q = gy * W + gx;
      if (seaD(((gx + 0.5) * RW) / W, ((gy + 0.5) * RH) / H) >= 0) {
        landMask[q] = 1;
        landCount++;
      }
    }
  const land = new Uint32Array(landCount),
    comp = new Int32Array(N);
  comp.fill(-1);
  let lp = 0;
  for (let q = 0; q < N; q++) if (landMask[q]) land[lp++] = q;
  const queue = new Uint32Array(landCount),
    componentSizes = [];
  let componentCount = 0;
  for (let q = 0; q < N; q++) {
    if (!landMask[q] || comp[q] >= 0) continue;
    let head = 0,
      tail = 0;
    queue[tail++] = q;
    comp[q] = componentCount;
    while (head < tail) {
      const at = queue[head++],
        x = at % W,
        y = (at / W) | 0,
        ns = [
          y * W + ((x + W - 1) % W),
          y * W + ((x + 1) % W),
          y ? at - W : -1,
          y < H - 1 ? at + W : -1,
        ];
      for (const n of ns) {
        if (n >= 0 && landMask[n] && comp[n] < 0) {
          comp[n] = componentCount;
          queue[tail++] = n;
        }
      }
    }
    componentSizes.push(tail);
    componentCount++;
  }
  const target = Math.min(
      300000,
      Math.max(componentCount, Math.ceil(landCount * (version >= 3 ? 0.06 : 0.24))),
    ),
    owner = new Uint32Array(N),
    points = new Uint32Array(target),
    hasComponent = new Uint8Array(componentCount);
  let count = 0;
  for (let q = 0; q < N; q++)
    if (landMask[q]) {
      const ci = comp[q];
      if (!hasComponent[ci]) {
        hasComponent[ci] = 1;
        owner[q] = ++count;
        points[count - 1] = q;
      }
    }
  for (let i = 0; i < landCount && count < target; i++) {
    const j = i + Math.floor(rr() * (landCount - i)),
      q = land[j];
    land[j] = land[i];
    land[i] = q;
    if (owner[q]) continue;
    owner[q] = ++count;
    points[count - 1] = q;
  }
  let head = 0,
    tail = count;
  for (let i = 0; i < count; i++) queue[i] = points[i];
  while (head < tail) {
    const q = queue[head++],
      x = q % W,
      y = (q / W) | 0,
      ns = [
        y * W + ((x + W - 1) % W),
        y * W + ((x + 1) % W),
        y ? q - W : -1,
        y < H - 1 ? q + W : -1,
      ],
      id = owner[q];
    for (const n of ns) {
      if (n < 0 || !landMask[n] || owner[n] || comp[n] !== comp[q]) continue;
      owner[n] = id;
      queue[tail++] = n;
    }
  }
  const sizes = new Uint32Array(count),
    area = new Float64Array(count);
  for (let q = 0; q < N; q++) {
    const id = owner[q] - 1;
    if (id < 0) continue;
    sizes[id]++;
    const lat = ((Math.floor(q / W) + 0.5) / H - 0.5) * Math.PI;
    area[id] += (RW / W) * (RH / H) * Math.max(0.08, Math.cos(lat));
  }
  S.adminMap = {
    version: version >= 3 ? version : 2,
    W,
    H,
    owner,
    component: comp,
    points: points.slice(0, count),
    sizes,
    area,
    count,
  };
  S.districts = [];
  rebuildDistrictLookup();
}
export function rebuildDistrictLookup() {
  S.districtById = new Map();
  (S.regions || []).forEach((r) => {
    r.districts = [];
  });
  (S.districts || []).forEach((d) => {
    if (!d || !Number.isInteger(+d.id)) return;
    d.id = +d.id;
    S.districtById.set(d.id, d);
    const r = S.regions[d.regionId];
    if (r && !r.districts.includes(d.id)) r.districts.push(d.id);
  });
}
export function districtAt(x, y) {
  const a = S && S.adminMap;
  if (!a) return -1;
  const gx = clamp(Math.floor((wrapX(x) / RW) * a.W), 0, a.W - 1),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  let id = a.owner[gy * a.W + gx] - 1;
  if (id >= 0) return id;
  if (S.planet && seaD(x, y) < 0) return -1;
  let best = -1,
    bd = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    const ny = gy + oy;
    if (ny < 0 || ny >= a.H) continue;
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = (gx + ox + a.W) % a.W,
        q = ny * a.W + nx,
        k = a.owner[q] - 1;
      if (k < 0) continue;
      const px = ((nx + 0.5) * RW) / a.W,
        py = ((ny + 0.5) * RH) / a.H,
        d = geoXY(x, y, px, py);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
  }
  return bd <= Math.hypot(RW / a.W, RH / a.H) * 0.8 ? best : -1;
}
export function districtRecordAt(x, y) {
  const id = districtAt(x, y);
  return id < 0 ? null : (S.districtById && S.districtById.get(id)) || null;
}
export function districtArea(id) {
  return (S.adminMap && S.adminMap.area[id]) || 0;
}
export function claimDistrict(id, regionId, ruralPop?, addRural = true) {
  if (!S.adminMap || id < 0 || id >= S.adminMap.count) return null;
  let d = S.districtById.get(id);
  if (d) return d;
  let ri = Number.isInteger(regionId) ? regionId : -1;
  if (ri < 0 || !S.regions[ri]) {
    ri = S.regions.length;
    S.regions.push({
      name: "Регион " + (ri + 1),
      color: DCOL[ri % DCOL.length],
      cities: [],
      center: null,
      manualCities: [],
      districts: [],
    });
  }
  d = {
    id,
    regionId: ri,
    centerCity: null,
    ruralPop: Number.isFinite(ruralPop) ? ruralPop : clamp(districtArea(id) * 1.5, 1200, 35000),
    upkeep: districtArea(id) * 0.000002,
  };
  S.districts.push(d);
  S.districtById.set(id, d);
  S.regions[ri].districts.push(id);
  if (addRural) S.ruralPool = (S.ruralPool || 0) + d.ruralPop;
  DIST.key = "";
  return d;
}
export function initialDistrictIds(x, y, n) {
  const a = S.adminMap;
  if (!a) return [];
  const gx = clamp(Math.floor((wrapX(x) / RW) * a.W), 0, a.W - 1),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  let start = gy * a.W + gx;
  if (!a.owner[start]) {
    const id = districtAt(x, y);
    if (id < 0) return [];
    start = a.points[id];
  }
  const q = new Int32Array(a.W * a.H),
    seen = new Uint8Array(a.W * a.H),
    ids = [],
    found = new Set();
  let h = 0,
    t = 0;
  q[t++] = start;
  seen[start] = 1;
  while (h < t && ids.length < n) {
    const cell = q[h++],
      id = a.owner[cell] - 1;
    if (id >= 0 && !found.has(id)) {
      found.add(id);
      ids.push(id);
    }
    const cx = cell % a.W,
      cy = (cell / a.W) | 0,
      ns = [
        cy * a.W + ((cx + a.W - 1) % a.W),
        cy * a.W + ((cx + 1) % a.W),
        cy ? a.W * (cy - 1) + cx : -1,
        cy < a.H - 1 ? cell + a.W : -1,
      ];
    for (const z of ns)
      if (z >= 0 && !seen[z] && a.owner[z]) {
        seen[z] = 1;
        q[t++] = z;
      }
  }
  return ids;
}
export function startingTownSite(x, y, ids) {
  if (!S.adminMap) return null;
  const a = S.adminMap,
    allowed = new Set(ids),
    cx = Math.floor((wrapX(x) / RW) * a.W),
    cy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1),
    rx = Math.ceil(220 / (RW / a.W)),
    ry = Math.ceil(220 / (RH / a.H));
  let best = null,
    relaxed = null;
  for (let oy = -ry; oy <= ry; oy++) {
    const gy = cy + oy;
    if (gy < 0 || gy >= a.H) continue;
    for (let ox = -rx; ox <= rx; ox++) {
      const gx = (cx + ox + a.W) % a.W,
        q = gy * a.W + gx,
        id = a.owner[q] - 1;
      if (id < 0 || !allowed.has(id)) continue;
      const px = ((gx + 0.5) * RW) / a.W,
        py = ((gy + 0.5) * RH) / a.H,
        d = geoXY(x, y, px, py);
      if (
        d < 10 ||
        d > 220 ||
        isIceAt(px, py) ||
        seaD(px, py) < 5 ||
        mtVal(px, py) > 0.55 ||
        riverDist(px, py) < 0.5
      )
        continue;
      const score =
          Math.abs(d - 45) + forestVal(px, py) * 8 + Math.max(0, 12 - seaD(px, py)) * 0.08,
        candidate = { x: px, y: py, score };
      if (!relaxed || score < relaxed.score) relaxed = candidate;
      if (d >= 22 && d <= 150 && (!best || score < best.score)) best = candidate;
    }
  }
  return best || relaxed;
}
function districtLandComponent(id) {
  const a = S.adminMap;
  if (!a || id < 0 || id >= a.count) return -1;
  return a.component ? a.component[a.points[id]] : -1;
}
export function districtsInLandComponent(id) {
  const a = S.adminMap,
    component = districtLandComponent(id);
  if (!a || component < 0) return 0;
  if (!a.componentDistrictCounts) {
    const counts = [];
    for (let i = 0; i < a.count; i++) {
      const c = districtLandComponent(i);
      if (c >= 0) counts[c] = (counts[c] || 0) + 1;
    }
    a.componentDistrictCounts = counts;
  }
  return a.componentDistrictCounts[component] || 0;
}
function assignDistrictRegion(id, regionId) {
  const d = S.districtById.get(+id),
    ri = +regionId;
  if (!d || !S.regions[ri]) return false;
  if (d.regionId === ri) return true;
  const component = districtLandComponent(d.id),
    target = S.regions[ri];
  if ((target.districts || []).some((other) => districtLandComponent(other) !== component))
    return false;
  const old = S.regions[d.regionId];
  if (old) old.districts = old.districts.filter((x) => x !== d.id);
  d.regionId = ri;
  if (!target.districts.includes(d.id)) target.districts.push(d.id);
  S.cities.forEach((c) => {
    if (c.districtId === d.id && target.center == null) target.center = c.i;
  });
  DIST.key = "";
  ZONE.key = "";
  return true;
}
function districtStatus(d) {
  const cities = S.cities.filter((c) => c.districtId === d.id);
  if (!cities.length) return "межселенная территория";
  const r = S.regions[d.regionId];
  if (r && (r.districts || []).length === 1) return "город-регион · республиканского значения";
  const center = cities.find((c) => c.i === d.centerCity);
  return center ? "районный центр: " + center.name : "город есть · центр не назначен";
}
function splitRegionsAcrossSea() {
  const original = S.regions.length;
  for (let ri = 0; ri < original; ri++) {
    const r = S.regions[ri],
      groups = new Map();
    (r.districts || []).forEach((id) => {
      const component = districtLandComponent(id);
      if (!groups.has(component)) groups.set(component, []);
      groups.get(component).push(id);
    });
    if (groups.size < 2) continue;
    const entries = [...groups.values()];
    r.districts = entries[0];
    for (let j = 1; j < entries.length; j++) {
      const ids = entries[j],
        next = S.regions.length,
        name = (r.name || "Регион " + (ri + 1)) + " · отдельная суша " + (j + 1);
      S.regions.push({
        name,
        color: DCOL[next % DCOL.length],
        cities: [],
        center: null,
        manualCities: [],
        districts: ids.slice(),
      });
      ids.forEach((id) => {
        const d = S.districtById.get(id);
        if (d) d.regionId = next;
      });
    }
  }
}
export function restoreTerritory() {
  if (!S.planet) return;
  if (!S.regions.length && S.cities.length)
    S.regions.push({
      name: "Регион 1",
      color: DCOL[0],
      cities: [0],
      center: 0,
      manualCities: [],
      districts: [],
    });
  if (!S.districts.length) {
    S.regions.forEach((r) => (r.districts = []));
    S.regions.forEach((r, ri) => {
      const anchor = S.cities[r.center] || S.cities[(r.cities || [])[0]] || S.cities[0];
      if (anchor)
        initialDistrictIds(anchor.x, anchor.y, 5).forEach((id) =>
          claimDistrict(id, ri, undefined, false),
        );
      (r.cities || []).forEach((i) => {
        const c = S.cities[i];
        if (c) {
          const id = districtAt(c.x, c.y);
          if (id >= 0) claimDistrict(id, ri, undefined, false);
        }
      });
    });
  }
  splitRegionsAcrossSea();
  S.cities.forEach((c) => {
    c.districtId = districtAt(c.x, c.y);
    let d = S.districtById.get(c.districtId);
    if (!d && c.districtId >= 0) {
      const current = S.regions.findIndex(
        (r) => r.center === c.i || (r.cities || []).includes(c.i),
      );
      const ri = current >= 0 ? current : Math.max(0, S.regions.length - 1);
      d = claimDistrict(c.districtId, ri, undefined, false);
    }
    if (d && d.centerCity == null) d.centerCity = c.i;
  });
}
function cityLandComponent(i) {
  const c = S.cities[i];
  if (!c || !S.planet) return -1;
  const a = S.adminMap;
  if (a && a.component) {
    const x = clamp(Math.floor((wrapX(c.x) / RW) * a.W), 0, a.W - 1),
      y = clamp(Math.floor((c.y / RH) * a.H), 0, a.H - 1);
    return a.component[y * a.W + x];
  }
  const W = 720,
    H = 360,
    x = Math.floor((wrapX(c.x) / RW) * W),
    y = clamp(Math.floor((c.y / RH) * H), 0, H - 1);
  return landComponents()[y * W + x];
}
function distCompute() {
  const cs = S.cities,
    key =
      (S.planet ? "planet|" : "") +
      S.seed +
      "|" +
      cs.map((c) => c.x + ":" + c.y).join(",") +
      "|" +
      S.ext.map((e) => e.gx + ":" + e.gy).join(",") +
      "|" +
      S.regions
        .map(
          (d) =>
            d.color +
            ":" +
            d.center +
            ":" +
            (d.manualCities || []).join(",") +
            ":" +
            (d.districts || []).join(","),
        )
        .join(";") +
      "|" +
      (S.districts || []).map((d) => d.id + ":" + d.regionId).join(",");
  if (DIST.key === key && DIST.img) return;
  DIST.key = key;
  const W = S.planet && S.adminMap ? S.adminMap.W : S.planet ? 720 : 320,
    H = S.planet && S.adminMap ? S.adminMap.H : S.planet ? 360 : 240,
    N = W * H,
    cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H),
    cnt = S.regions.map(() => 0),
    area = S.regions.map(() => 0),
    cell = new Int32Array(N).fill(-1);
  if (S.planet && S.adminMap) {
    for (let q = 0; q < N; q++) cell[q] = S.adminMap.owner[q] - 1;
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const q = gy * W + gx,
          id = cell[q];
        if (id < 0) continue;
        const d = S.districtById.get(id),
          ri = d ? d.regionId : -1,
          nb = (a, b) => (b < 0 || b >= H ? -1 : cell[b * W + (S.planet ? (a + W) % W : a)]),
          neighbors = [nb(gx - 1, gy), nb(gx + 1, gy), nb(gx, gy - 1), nb(gx, gy + 1)],
          edge = neighbors.some((v) => v !== id),
          regionEdge = neighbors.some((v) => {
            const n = S.districtById.get(v);
            return v !== id && n && d && n.regionId !== ri;
          });
        let color = "#9CA5A0",
          alpha = edge ? 210 : 0;
        if (d) {
          const reg = S.regions[ri];
          color = reg ? reg.color : "#AAB7AF";
          alpha = regionEdge ? 255 : edge ? 210 : 24;
          cnt[ri] = (cnt[ri] || 0) + 1;
          const lat = ((gy + 0.5) / H - 0.5) * Math.PI;
          area[ri] = (area[ri] || 0) + (RW / W) * (RH / H) * Math.max(0.08, Math.cos(lat));
        }
        const col = hex(color),
          p = q * 4;
        im.data[p] = col[0];
        im.data[p + 1] = col[1];
        im.data[p + 2] = col[2];
        im.data[p + 3] = alpha;
      }
  } else {
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const wx = ((gx + 0.5) * RW) / W,
          wy = ((gy + 0.5) * RH) / H;
        let bi = -1,
          bd = Infinity;
        S.regions.forEach((d, k) =>
          d.cities.forEach((ci) => {
            const c = cs[ci],
              q = Math.hypot(c.x - wx, c.y - wy);
            if (q < bd) {
              bd = q;
              bi = k;
            }
          }),
        );
        if (bi >= 0) {
          cell[gy * W + gx] = bi;
          cnt[bi]++;
          area[bi] += (RW / W) * (RH / H);
        }
      }
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const q = gy * W + gx,
          v = cell[q];
        if (v < 0) continue;
        const nb = (a, b) => (b < 0 || b >= H ? -1 : cell[b * W + a]),
          edge =
            nb(gx - 1, gy) !== v ||
            nb(gx + 1, gy) !== v ||
            nb(gx, gy - 1) !== v ||
            nb(gx, gy + 1) !== v,
          col = hex(S.regions[v].color),
          p = q * 4;
        im.data[p] = col[0];
        im.data[p + 1] = col[1];
        im.data[p + 2] = col[2];
        im.data[p + 3] = edge ? 220 : 34;
      }
  }
  x.putImageData(im, 0, 0);
  DIST.img = cv;
  DIST.cnt = cnt;
  DIST.area = area;
  DIST.cell = cell;
  DIST.W = W;
  DIST.H = H;
  DIST.cellA = S.planet ? (RW / W) * (RH / H) : (RW / W) * (RH / H);
  DIST.nations = [];
}
export function drawCountryNames(ctx, s, wrapShift) {
  if (!S.planet || mapScaleTier() !== 0 || !S.ext.length) return;
  distCompute();
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed = [],
    order = S.ext
      .map((e, i) => ({ e, i, p: DIST.nations[i] }))
      .filter((v) => v.p)
      .sort((a, b) => b.p.area - a.p.area);
  order.forEach(({ e, p }) => {
    const text = e.name.toUpperCase(),
      x = (p.x + wrapShift) * s,
      y = p.y * s,
      fs = clamp(11 + Math.sqrt(p.area) * s * 0.055, 12, 26);
    let drawFs = fs;
    ctx.font = "italic 700 " + fs + "px " + FONT.b;
    const tw = ctx.measureText(text).width,
      pad = 5,
      gap = Math.max(fs * 1.55, tw * 0.2),
      candidates = [
        [0, 0],
        [0, -gap],
        [0, gap],
        [-gap, 0],
        [gap, 0],
        [0, -gap * 1.8],
        [0, gap * 1.8],
        [-gap, -gap],
        [gap, gap],
      ];
    let pos = null;
    for (const [dx, dy] of candidates) {
      const box = {
        x: x + dx - tw / 2 - pad,
        y: y + dy - fs * 0.7 - pad,
        w: tw + pad * 2,
        h: fs * 1.4 + pad * 2,
      };
      if (
        placed.every(
          (b) =>
            box.x + box.w + 4 < b.x ||
            b.x + b.w + 4 < box.x ||
            box.y + box.h + 3 < b.y ||
            b.y + b.h + 3 < box.y,
        )
      ) {
        pos = { x: x + dx, y: y + dy, box };
        break;
      }
    }
    if (!pos) {
      drawFs = 11;
      ctx.font = "italic 700 " + drawFs + "px " + FONT.b;
      const small = ctx.measureText(text).width,
        box = { x: x - small / 2 - 3, y: y - 9, w: small + 6, h: 18 };
      if (
        placed.some(
          (b) =>
            !(
              box.x + box.w + 3 < b.x ||
              b.x + b.w + 3 < box.x ||
              box.y + box.h + 2 < b.y ||
              b.y + b.h + 2 < box.y
            ),
        )
      )
        return;
      pos = { x, y, box };
    }
    placed.push(pos.box);
    ctx.font = "italic 700 " + drawFs + "px " + FONT.b;
    ctx.lineWidth = Math.max(1.7, drawFs * 0.14);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(18,29,31,.58)";
    ctx.fillStyle = "rgba(245,239,220,.67)";
    ctx.strokeText(text, pos.x, pos.y);
    ctx.fillText(text, pos.x, pos.y);
  });
  ctx.restore();
}
export function drawRegionDistricts(ctx, s, wrapShift = 0, w = 0, h = 0, OX = 0, OY = 0) {
  if (!S.regions.length) return;
  distCompute();
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  drawViewportImage(ctx, DIST.img, s, wrapShift, w, h, OX, OY);
  ctx.restore();
  S.regions.forEach((d) => {
    if (d.center == null || !S.cities[d.center]) return;
    const c = S.cities[d.center];
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x * s, c.y * s, radius(c, s) + 5, 0, 6.29);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c.x * s, c.y * s, radius(c, s) + 9, 0, 6.29);
    ctx.stroke();
  });
  S.regions.forEach((d, k) => {
    if (dPick === k)
      d.cities.forEach((i) => {
        const c = S.cities[i];
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x * s, c.y * s, radius(c, s) + 7, 0, 6.29);
        ctx.stroke();
      });
  });
}
function regionDistStats(d, k) {
  const cs = d.cities.map((i) => S.cities[i]),
    districts = (S.districts || []).filter((q) => q.regionId === k),
    ids = new Set(districts.map((q) => q.id));
  let rural = 0;
  S.ruralSites &&
    S.ruralSites.forEach((v) => {
      if (ids.has(v.districtId)) rural += v.p;
    });
  return {
    districts: districts.length,
    n: cs.length,
    P: cs.reduce((a, c) => a + c.P + c.R, 0) + rural,
    F: cs.reduce((a, c) => a + SECT.reduce((b, x) => b + c.firms[x.k], 0), 0),
    A: S.planet
      ? districts.reduce((a, q) => a + districtArea(q.id), 0)
      : (DIST.cnt[k] || 0) * DIST.cellA,
  };
}
function syncRows(tb, rows, cols, empty) {
  if (!rows.length) {
    if (tb.dataset.n !== "0") {
      tb.innerHTML = '<tr><td class="empty" colspan="' + cols + '">' + empty + "</td></tr>";
      tb.dataset.n = "0";
    }
    return;
  }
  if (tb.dataset.n !== String(rows.length)) {
    tb.innerHTML = rows
      .map(
        (r, i) =>
          '<tr><td class="l"><input type="text" maxlength="32" data-i="' +
          i +
          '" aria-label="Название области"></td>' +
          r.cells.map(() => "<td></td>").join("") +
          '<td style="white-space:nowrap"><button class="link" type="button" data-edit="' +
          i +
          '">состав</button><button class="link" type="button" data-del="' +
          i +
          '">удалить</button></td></tr>',
      )
      .join("");
    tb.dataset.n = String(rows.length);
  }
  [...tb.children].forEach((tr, i) => {
    const inp = tr.querySelector("input");
    if (document.activeElement !== inp) inp.value = rows[i].name;
    inp.style.color = rows[i].color;
    rows[i].cells.forEach((v, k) => {
      tr.children[k + 1].textContent = v;
    });
  });
}
export function drawDist() {
  distCompute();
  const tb = $("#dbody");
  if (!S.regions.length) {
    if (tb.dataset.n !== "0") {
      tb.innerHTML =
        '<tr><td class="empty" colspan="7">Регионов пока нет. Присоедините район и распределите его по регионам.</td></tr>';
      tb.dataset.n = "0";
    }
    return;
  }
  const sig = S.regions
    .map(
      (d) =>
        d.cities.map((i) => i + ":" + S.cities[i].name).join(",") +
        "|" +
        d.center +
        "|" +
        (d.districts || []).join(","),
    )
    .join(";");
  if (tb.dataset.n !== sig && !(document.activeElement && tb.contains(document.activeElement))) {
    tb.innerHTML = S.regions
      .map((d, i) => {
        const opts = d.cities
          .map(
            (ci) =>
              '<option value="' +
              ci +
              '"' +
              (ci === d.center ? " selected" : "") +
              ">" +
              esc(S.cities[ci].name) +
              "</option>",
          )
          .join("");
        return (
          '<tr><td class="l"><input type="text" maxlength="32" data-i="' +
          i +
          '" aria-label="Название региона"></td><td class="l">' +
          (opts
            ? '<select data-dc="' + i + '" aria-label="Центр региона">' + opts + "</select>"
            : "–") +
          "</td><td></td><td></td><td></td><td></td><td>" +
          (S.planet
            ? ""
            : '<button class="link" type="button" data-edit="' + i + '">города</button>') +
          "</td></tr>"
        );
      })
      .join("");
    tb.dataset.n = sig;
  }
  [...tb.children].forEach((tr, i) => {
    const d = S.regions[i];
    if (!d) return;
    const st = regionDistStats(d, i),
      inp = tr.querySelector("input");
    if (inp) {
      if (document.activeElement !== inp) inp.value = d.name;
      inp.style.color = d.color;
    }
    [st.districts, st.n, fmtPop(st.P), fmtN(st.A) + " км²"].forEach((v, k) => {
      if (tr.children[k + 2]) tr.children[k + 2].textContent = v;
    });
  });
}
const TERRITORY_PAGE_SIZE = 100;
export function drawTerritory() {
  const box = $("#territoryBody"),
    summary = $("#territorySummary");
  if (!box || !summary) return;
  const claimed = S.districts || [],
    unsettled = claimed.filter((d) => !S.cities.some((c) => c.districtId === d.id)).length,
    free = Math.max(0, (S.adminMap ? S.adminMap.count : 0) - claimed.length);
  summary.textContent =
    "В государстве: " +
    claimed.length +
    " районов · свободно: " +
    free +
    " · межселенная территория: " +
    unsettled +
    " · сельских жителей: " +
    fmtPop(S.ruralPool || 0) +
    ". Свободные районы не входят в государство.";
  const search = ($("#territorySearch")?.value || "").trim().toLocaleLowerCase("ru"),
    filtered = search
      ? claimed.filter((d) => {
          const label = "район " + (d.id + 1),
            cities = S.cities
              .filter((c) => c.districtId === d.id)
              .map((c) => c.name.toLocaleLowerCase("ru"));
          return (
            String(d.id + 1).includes(search) ||
            label.includes(search) ||
            cities.some((n) => n.includes(search)) ||
            String(S.regions[d.regionId]?.name || "")
              .toLocaleLowerCase("ru")
              .includes(search)
          );
        })
      : claimed;
  const pages = Math.max(1, Math.ceil(filtered.length / TERRITORY_PAGE_SIZE));
  setTerritoryPage(clamp(territoryPage, 0, pages - 1));
  const rows = filtered.slice(
    territoryPage * TERRITORY_PAGE_SIZE,
    (territoryPage + 1) * TERRITORY_PAGE_SIZE,
  );
  $("#territoryPageLabel").textContent = filtered.length
    ? territoryPage * TERRITORY_PAGE_SIZE +
      1 +
      "–" +
      Math.min(filtered.length, (territoryPage + 1) * TERRITORY_PAGE_SIZE) +
      " из " +
      filtered.length
    : "0 районов";
  $("#territoryPrev").disabled = territoryPage <= 0;
  $("#territoryNext").disabled = territoryPage >= pages - 1;
  const sig =
    rows.map((d) => d.id + ":" + d.regionId + ":" + d.centerCity).join(",") +
    "|" +
    S.regions.map((r) => r.name).join("|") +
    "|" +
    search;
  if (box.dataset.n !== sig && !(document.activeElement && box.contains(document.activeElement))) {
    box.innerHTML = rows.length
      ? rows
          .map((d) => {
            const cities = S.cities.filter((c) => c.districtId === d.id),
              region = esc(S.regions[d.regionId]?.name || "—");
            const centerOpts =
              '<option value=""' +
              (d.centerCity == null ? " selected" : "") +
              ">— не назначен —</option>" +
              cities
                .map(
                  (c) =>
                    '<option value="' +
                    c.i +
                    '"' +
                    (c.i === d.centerCity ? " selected" : "") +
                    ">" +
                    esc(c.name) +
                    "</option>",
                )
                .join("");
            return (
              '<tr><td class="l">Район ' +
              (d.id + 1) +
              "</td><td>" +
              region +
              '</td><td><select data-district-center="' +
              d.id +
              '" aria-label="Районный центр района ' +
              (d.id + 1) +
              '"' +
              (cities.length ? "" : " disabled") +
              ">" +
              centerOpts +
              "</select></td><td>" +
              esc(districtStatus(d)) +
              "</td><td>" +
              fmtM(d.upkeep) +
              "/год</td></tr>"
            );
          })
          .join("")
      : '<tr><td class="empty" colspan="5">' +
        (search ? "По запросу ничего не найдено." : "Присоединённых районов пока нет.") +
        "</td></tr>";
    box.dataset.n = sig;
  }
}
function nearestMajorCityToDistrict(id) {
  const a = S.adminMap,
    q = a.points[id],
    gx = q % a.W,
    gy = (q / a.W) | 0,
    x = ((gx + 0.5) * RW) / a.W,
    y = ((gy + 0.5) * RH) / a.H;
  let best = null;
  S.cities.forEach((c) => {
    if (c.P < 100000) return;
    const km = geoXY(c.x, c.y, x, y);
    if (!best || km < best.km) best = { city: c, km };
  });
  return best;
}
function placeDistrictPopup() {
  const box = $("#territoryPopup"),
    view = $("#view");
  if (box.hidden) return;
  const vr = view.getBoundingClientRect(),
    w = box.offsetWidth,
    h = box.offsetHeight;
  box.style.left = clamp(districtPopupAnchor.x + 12, 8, Math.max(8, vr.width - w - 8)) + "px";
  box.style.top = clamp(districtPopupAnchor.y + 12, 8, Math.max(8, vr.height - h - 8)) + "px";
}
function showDistrictPopup(id) {
  const box = $("#territoryPopup"),
    owned = S.districtById.get(id),
    area = fmtN(districtArea(id)) + " км²";
  box.dataset.id = String(id);
  box.hidden = false;
  if (!owned) {
    const near = nearestMajorCityToDistrict(id),
      extra = near ? Math.ceil(near.km / 10) : 0,
      cost = 15 + extra;
    box.innerHTML =
      "<b>Свободный район " +
      (id + 1) +
      '</b><span class="note">Площадь: ' +
      area +
      '</span><span class="note">Присоединение: 15 млрд' +
      (near
        ? " + 1 млрд за каждые 10 км от «" + esc(near.city.name) + "» · " + fmtN(near.km) + " км"
        : " · рядом пока нет города от 100 тыс.") +
      '</span><button type="button" data-district-claim>Включить в государство · ' +
      fmtM(cost) +
      "</button>";
  } else {
    const component = districtLandComponent(id),
      fits = (r) =>
        !(r.districts || []).some((other) => districtLandComponent(other) !== component) &&
        !(r.center != null && cityLandComponent(r.center) !== component) &&
        !(r.manualCities || []).some((ci) => cityLandComponent(ci) !== component),
      opts = S.regions
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => fits(r))
        .map(
          ({ r, i }) =>
            '<option value="' +
            i +
            '"' +
            (i === owned.regionId ? " selected" : "") +
            ">" +
            esc(r.name) +
            "</option>",
        )
        .join("");
    box.innerHTML =
      "<b>Район " +
      (id + 1) +
      '</b><span class="note">Площадь: ' +
      area +
      " · сейчас: " +
      esc(S.regions[owned.regionId]?.name || "без региона") +
      '</span><label class="note">Выберите регион<select data-district-popup-region>' +
      opts +
      '<option value="new">Создать новый регион</option></select></label>';
  }
  placeDistrictPopup();
}
export function openDistrictPopup(x, y, e) {
  const id = districtAt(x, y);
  if (id < 0) {
    $("#territoryPopup").hidden = true;
    flash("Здесь нет района суши.");
    return;
  }
  const rect = $("#view").getBoundingClientRect();
  setDistrictPopupAnchor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  showDistrictPopup(id);
}
export function endPick() {
  const d = S.regions[dPick];
  if (d && !d.cities.length && !(S.planet && (d.districts || []).length))
    S.regions.splice(dPick, 1);
  else if (d) logEv("Регион «" + d.name + "»: городов " + d.cities.length);
  setDPick(null);
  DIST.key = "";
  $("#dbody").dataset.n = "";
  toolButtons();
  render();
}
export function pickClick(m) {
  const k = nodeAt(m);
  if (k == null || typeof k === "string") return;
  const d = S.regions[dPick];
  if (S.planet) {
    if (S.regions.some((o) => o.center === k && o !== d)) {
      flash("Город остаётся центром своей области.");
      return;
    }
    d.manualCities = d.manualCities || [];
    const at = d.manualCities.indexOf(k);
    if (at >= 0) d.manualCities.splice(at, 1);
    else {
      if (d.center != null && cityLandComponent(d.center) !== cityLandComponent(k)) {
        flash("Область не может объединять сушу через море. Создайте отдельную область.");
        return;
      }
      S.regions.forEach((o) => {
        o.manualCities = (o.manualCities || []).filter((i) => i !== k);
      });
      d.manualCities.push(k);
    }
    DIST.key = "";
    evaluate();
    render();
    return;
  }
  const at = d.cities.indexOf(k);
  if (at >= 0) d.cities.splice(at, 1);
  else {
    S.regions.forEach((o) => {
      const j = o.cities.indexOf(k);
      if (j >= 0) o.cities.splice(j, 1);
    });
    d.cities.push(k);
  }
  DIST.key = "";
  render();
}
/* user-drawn roads between nodes */
export function nodeAt(m) {
  const r = RC.getBoundingClientRect(),
    w = r.width,
    h = r.height,
    s = (w / RW) * V.z,
    OX = w / 2 - V.cx * s,
    OY = h / 2 - V.cy * s,
    mx = (S.planet ? nearX(m.x, V.cx) : m.x) * s + OX,
    my = m.y * s + OY;
  let best = null,
    bd = 1e9;
  S.cities.forEach((c) => {
    if (isSat(c) && !(rdraw || airDraft || dPick != null)) return;
    const cx = (S.planet ? nearX(c.x, V.cx) : c.x) * s + OX,
      d = Math.hypot(cx - mx, c.y * s + OY - my) - radius(c, s);
    if (d < 10 && d < bd) {
      bd = d;
      best = c.i;
    }
  });
  S.ext.forEach((e) => {
    const ex = (S.planet ? nearX(e.gx, V.cx) : e.gx) * s + OX,
      d = Math.hypot(ex - mx, e.gy * s + OY - my) - 6;
    if (d < 10 && d < bd) {
      bd = d;
      best = "e" + e.k;
    }
  });
  return best;
}
function nodePos(k) {
  const o = byKey(k);
  if (!o.ext) return [o.x, o.y];
  const r = RC.getBoundingClientRect(),
    w = r.width,
    h = r.height,
    s = (w / RW) * V.z,
    OX = w / 2 - V.cx * s,
    OY = h / 2 - V.cy * s;
  return [(clamp(o.gx * s + OX, 6, w - 6) - OX) / s, (clamp(o.gy * s + OY, 6, h - 6) - OY) / s];
}
function segInfo(a, b) {
  const A = byKey(a),
    B = byKey(b),
    external = !!(A.ext || B.ext);
  if (typeof a === "string" && typeof b === "string")
    return { err: "между соседними государствами дорога не прокладывается" };
  const water = roadWaterError(a, b);
  if (water) return { err: water };
  if (rmode === "up") {
    const r = [linkBetween(a, b, "road"), linkBetween(a, b, "rail")].find((x) => x && !x.fast);
    if (!r) return { err: "здесь нечего модернизировать" };
    return {
      mode: r.mode,
      class: r.mode === "road" ? roadClass(r) : null,
      cost: linkCost(a, b, r.mode, true, r.mode === "road" ? roadClass(r) : null),
      up: true,
    };
  }
  if (rmode === "road") {
    const cls = selectedRoadClass(),
      r = linkBetween(a, b, "road");
    if (external && cls !== "international")
      return { err: "между государствами разрешён только международный класс дороги" };
    if (r) {
      const current = roadClass(r),
        from = ROAD_CLASS_RANK[current],
        to = ROAD_CLASS_RANK[cls];
      if (to === from) return { err: "этот класс дороги уже установлен" };
      if (to > from) return { err: "понизить класс дороги нельзя" };
      if (to !== from - 1)
        return { err: "повышайте класс по порядку: региональный, национальный, международный" };
      const cost = Math.max(
        0,
        linkCost(a, b, "road", false, cls) - linkCost(a, b, "road", false, current),
      );
      return { mode: "road", class: cls, classUpgrade: true, cost };
    }
    if (linkBetween(a, b, "rail")) return { err: "железная дорога уже есть на этой паре городов" };
    return { mode: "road", class: cls, cost: linkCost(a, b, "road", false, cls) };
  }
  if (linkBetween(a, b, rmode))
    return { err: rmode === "rail" ? "железная дорога уже есть" : "дорога уже есть" };
  return { mode: rmode, cost: linkCost(a, b, rmode, false) };
}
export function roadClick(m) {
  const k = nodeAt(m);
  if (k == null) {
    rdraw.from = null;
    rdraw.msg = "";
    drawRegion();
    return;
  }
  if (rdraw.from == null || rdraw.from === k) {
    rdraw.from = k;
    rdraw.msg = "";
    drawRegion();
    return;
  }
  const a = rdraw.from,
    inf = segInfo(a, k);
  if (inf.err) {
    rdraw.msg = inf.err;
    rdraw.from = k;
    drawRegion();
    return;
  }
  const expense = inf.up
    ? inf.mode === "rail"
      ? "railUpgrade"
      : "roadUpgrade"
    : inf.classUpgrade
      ? "roadUpgrade"
      : inf.mode === "rail"
        ? "railBuild"
        : "road_" + inf.class;
  if (!spend(inf.cost, expense)) {
    rdraw.msg = "не хватает денег";
    drawRegion();
    return;
  }
  buildLink(a, k, inf.mode, inf.class, inf.classUpgrade ? "class" : inf.up ? "fast" : null);
  const A = byKey(a),
    B = byKey(k);
  logEv(
    inf.classUpgrade
      ? "Дорога " +
          A.name +
          " – " +
          B.name +
          " повышена до " +
          ROAD_CLASS_LABELS[inf.class] +
          " класса"
      : inf.up
        ? (inf.mode === "rail" ? "Железная дорога " : "Дорога ") +
          A.name +
          " – " +
          B.name +
          " стала скоростной"
        : "Проложена " +
          (inf.class
            ? ROAD_CLASS_LABELS[inf.class] + " автодорога "
            : inf.mode === "rail"
              ? "железная дорога "
              : "дорога ") +
          A.name +
          " – " +
          B.name,
  );
  rdraw.from = k;
  rdraw.msg = "";
  evaluate();
  render();
}
export function drawRoadGhost(ctx, s) {
  if (!rdraw || rdraw.from == null) return;
  const [ax, ay] = nodePos(rdraw.from),
    cls = rmode === "road" ? selectedRoadClass() : null,
    ghostColor =
      cls === "local"
        ? "#AAB8C1"
        : cls === "national"
          ? "#74D6F4"
          : cls === "international"
            ? "#C7A5FF"
            : "#F0B761";
  ctx.save();
  ctx.strokeStyle = ghostColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(ax * s, ay * s, 10, 0, 6.29);
  ctx.stroke();
  if (rdraw.hover) {
    const hk = nodeAt(rdraw.hover);
    let bx = rdraw.hover.x,
      by = rdraw.hover.y,
      txt = rdraw.msg || "";
    if (hk != null && hk !== rdraw.from) {
      [bx, by] = nodePos(hk);
      const inf = segInfo(rdraw.from, hk);
      txt = inf.err
        ? inf.err
        : (inf.classUpgrade
            ? "повышение до " + ROAD_CLASS_LABELS[inf.class] + " · "
            : inf.up
              ? "скоростная модернизация · "
              : inf.class
                ? ROAD_CLASS_LABELS[inf.class] + " дорога · "
                : "") +
          fmtM(inf.cost) +
          (S.budget < inf.cost ? ", не хватает денег" : "");
    }
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = rmode === "rail" ? rgb(C["c-rail"]) : ghostColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ax * s, ay * s);
    ctx.lineTo(bx * s, by * s);
    ctx.stroke();
    ctx.setLineDash([]);
    if (txt) {
      ctx.font = "12.5px " + FONT.b;
      ctx.fillStyle = rgb(C.ink);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      halo(ctx, txt, bx * s + 12, by * s - 10);
    }
  }
  ctx.restore();
}
export function airlineClick(m) {
  const k = nodeAt(m);
  if (k == null) {
    airDraft.from = null;
    airDraft.msg = "";
    drawRegion();
    return;
  }
  const c = S.cities[k];
  if (!c.air) {
    airDraft.msg = "В городе «" + c.name + "» нет аэропорта.";
    flash(airDraft.msg);
    return;
  }
  if (airDraft.from == null || airDraft.from === k) {
    airDraft.from = k;
    airDraft.msg = "";
    drawRegion();
    return;
  }
  const a = airDraft.from,
    b = k;
  if ((S.airRoutes || []).some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))) {
    S.sel = b;
    setTab("city", true);
    flash("Авиамаршрут между этими городами уже есть.");
    render();
    return;
  }
  const cost = airRouteCost(a, b);
  if (!spend(cost, "aviation")) {
    airDraft.msg = "Не хватает денег на авиамаршрут · " + fmtM(cost);
    flash(airDraft.msg);
    return;
  }
  const A = S.cities[a],
    B = S.cities[b];
  S.airRoutes.push({ a, b, fpm: 30 });
  logEv("Открыт авиамаршрут " + A.name + " – " + B.name + ", 30 рейсов в месяц");
  S.sel = b;
  setLAYER("airlinks");
  document
    .querySelectorAll("[data-layer]")
    .forEach((x) =>
      x.setAttribute(
        "aria-pressed",
        (x as HTMLElement).dataset.layer === "airlinks" ? "true" : "false",
      ),
    );
  setTab("city", true);
  airDraft.from = b;
  airDraft.msg = "Маршрут создан. Выберите следующий аэропорт или нажмите Esc.";
  evaluate();
  render();
}
export function cargoRouteClick(m) {
  const k = nodeAt(m);
  if (k == null) {
    cargoDraft.from = null;
    cargoDraft.msg = "";
    drawRegion();
    return;
  }
  const c = S.cities[k],
    type = cargoDraft.type;
  if (!c) {
    cargoDraft.msg = "Выберите город.";
    return;
  }
  if (!portLevel(c, type)) {
    cargoDraft.msg =
      "В городе «" + c.name + "» нет " + (type === "sea" ? "морского" : "речного") + " порта.";
    flash(cargoDraft.msg);
    return;
  }
  const access = type === "sea" ? seaPortAccess(c.x, c.y) : riverPortAccess(c.x, c.y);
  if (!access.ok) {
    cargoDraft.msg =
      "У города «" +
      c.name +
      "» нет подходящего " +
      (type === "sea" ? "морского" : "речного") +
      " доступа.";
    flash(cargoDraft.msg);
    return;
  }
  if (cargoDraft.from == null || cargoDraft.from === k) {
    cargoDraft.from = k;
    cargoDraft.msg = "";
    drawRegion();
    return;
  }
  const a = cargoDraft.from,
    b = k;
  if (
    (S.cargoRoutes || []).some(
      (r) => r.type === type && ((r.a === a && r.b === b) || (r.a === b && r.b === a)),
    )
  ) {
    cargoDraft.msg = "Такой маршрут уже проложен.";
    flash(cargoDraft.msg);
    return;
  }
  const A = S.cities[a],
    B = S.cities[b],
    points = type === "sea" ? seaCargoPath(A, B) : riverCargoPath(A, B)?.points;
  if (!points) {
    cargoDraft.msg =
      type === "sea"
        ? "Не удалось найти непрерывный морской путь между портами."
        : "Речные порты должны находиться на одном непрерывном русле.";
    flash(cargoDraft.msg);
    return;
  }
  const cost = cargoRouteCost(type, a, b);
  if (!spend(cost, "cargoBuild")) {
    cargoDraft.msg = "Не хватает денег на маршрут · " + fmtM(cost);
    flash(cargoDraft.msg);
    return;
  }
  S.cargoRoutes.push({ a, b, type, points });
  settleCargoFlows();
  logEv(
    "Открыт " +
      (type === "sea" ? "морской" : "речной") +
      " грузовой маршрут " +
      A.name +
      " – " +
      B.name,
  );
  S.sel = b;
  setLAYER("cargo");
  document
    .querySelectorAll("[data-layer]")
    .forEach((x) =>
      x.setAttribute(
        "aria-pressed",
        (x as HTMLElement).dataset.layer === "cargo" ? "true" : "false",
      ),
    );
  cargoDraft.from = b;
  cargoDraft.msg = "Линия построена. Выберите следующий порт или нажмите Esc.";
  evaluate();
  render();
}
export function drawAirlineGhost(ctx, s) {
  if (!airDraft) return;
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = rgb(C["c-air"], 0.9);
  ctx.lineWidth = 2.5;
  if (airDraft.from != null) {
    const A = S.cities[airDraft.from],
      ax = S.planet ? nearX(A.x, V.cx) : A.x,
      ay = A.y;
    ctx.beginPath();
    ctx.arc(ax * s, ay * s, 11, 0, 6.283);
    ctx.stroke();
    if (airDraft.hover) {
      const k = nodeAt(airDraft.hover),
        B = k == null ? null : S.cities[k],
        bx = B ? (S.planet ? nearX(B.x, ax) : B.x) : airDraft.hover.x,
        by = B ? B.y : airDraft.hover.y;
      ctx.beginPath();
      ctx.moveTo(ax * s, ay * s);
      ctx.lineTo(bx * s, by * s);
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function drawAirRouteLayer(ctx, s) {
  const routes = (S.airRoutes || []).filter(
    (r) => S.cities[r.a] && S.cities[r.b] && S.cities[r.a].air && S.cities[r.b].air,
  );
  routes.forEach((r, i) => {
    const A = S.cities[r.a],
      B = S.cities[r.b],
      ax = A.x,
      bx = S.planet ? nearX(B.x, ax) : B.x,
      ay = A.y,
      by = B.y,
      dx = bx - ax,
      dy = by - ay,
      L = Math.hypot(dx, dy) || 1,
      st = airRouteStats(r),
      share = 0.58 * clamp((st?.pax || 0) / 140000, 0, 1) + 0.42 * (st?.load || 0),
      color = share > 0.68 ? "#FFC86A" : share > 0.34 ? "#4FE3D2" : "#60B9FF",
      lw = 1.6 + 7 * Math.sqrt(share),
      bend = Math.min(45, L * 0.055) * (i % 2 ? -1 : 1),
      qx = (ax + bx) / 2 - (dy / L) * bend,
      qy = (ay + by) / 2 + (dx / L) * bend,
      path = () => {
        ctx.beginPath();
        ctx.moveTo(ax * s, ay * s);
        ctx.quadraticCurveTo(qx * s, qy * s, bx * s, by * s);
      };
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 13;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = lw + 7;
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(3,13,24,.94)";
    ctx.lineWidth = lw + 2.6;
    path();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    path();
    ctx.stroke();
    [A, B].forEach((c) => {
      const x = (c === A ? ax : bx) * s,
        y = (c === A ? ay : by) * s;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, 3.4 + lw * 0.32, 0, 6.283);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#EAFBFF";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 6 + lw * 0.32, 0, 6.283);
      ctx.stroke();
    });
    ctx.restore();
  });
}
function drawCargoPolyline(ctx, pts, s, shift) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo((pts[0][0] + shift) * s, pts[0][1] * s);
  if (pts.length === 2) {
    ctx.lineTo((pts[1][0] + shift) * s, pts[1][1] * s);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i],
      n = pts[i + 1],
      mx = (p[0] + n[0]) * 0.5,
      my = (p[1] + n[1]) * 0.5;
    ctx.quadraticCurveTo((p[0] + shift) * s, p[1] * s, (mx + shift) * s, my * s);
  }
  const p = pts[pts.length - 1];
  ctx.lineTo((p[0] + shift) * s, p[1] * s);
}
export function drawCargoRouteLayer(ctx, s, wrapShift) {
  (S.cargoRoutes || []).forEach((r) => {
    const st = cargoRouteStats(r),
      pts = r.points;
    if (!st || !pts || pts.length < 2) return;
    const middle = pts[Math.floor(pts.length / 2)][0],
      shift = S.planet ? Math.round((V.cx - middle) / RW) * RW + (wrapShift || 0) : 0,
      clr = st.type === "sea" ? "#72D7F4" : "#6CE0B4",
      load = clamp((r.annualTonnes || 0) / Math.max(1, st.capacity), 0, 1),
      lw = 1.5 + 5.3 * Math.sqrt(load);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = clr;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = clr;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = lw + 6;
    drawCargoPolyline(ctx, pts, s, shift);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(3,18,24,.95)";
    ctx.lineWidth = lw + 2.4;
    drawCargoPolyline(ctx, pts, s, shift);
    ctx.stroke();
    ctx.strokeStyle = clr;
    ctx.lineWidth = lw;
    drawCargoPolyline(ctx, pts, s, shift);
    ctx.stroke();
    [
      [pts[0][0], pts[0][1]],
      [pts[pts.length - 1][0], pts[pts.length - 1][1]],
    ].forEach((p) => {
      const x = (p[0] + shift) * s,
        y = p[1] * s;
      ctx.fillStyle = clr;
      ctx.beginPath();
      ctx.arc(x, y, 5.2, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = "#EAFBFF";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
    ctx.restore();
  });
}
export function drawCargoGhost(ctx, s) {
  if (!cargoDraft || cargoDraft.from == null || !cargoDraft.hover) return;
  const A = S.cities[cargoDraft.from],
    k = nodeAt(cargoDraft.hover),
    B = k == null ? null : S.cities[k],
    ax = S.planet ? nearX(A.x, V.cx) : A.x,
    ay = A.y,
    bx = B ? (S.planet ? nearX(B.x, ax) : B.x) : cargoDraft.hover.x,
    by = B ? B.y : cargoDraft.hover.y,
    dx = bx - ax,
    dy = by - ay,
    L = Math.hypot(dx, dy) || 1,
    bend = Math.min(32, L * 0.08),
    qx = (ax + bx) / 2 - (dy / L) * bend,
    qy = (ay + by) / 2 + (dx / L) * bend;
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = cargoDraft.type === "sea" ? "#72D7F4" : "#6CE0B4";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(ax * s, ay * s);
  ctx.quadraticCurveTo(qx * s, qy * s, bx * s, by * s);
  ctx.stroke();
  ctx.restore();
}

export function setupDistricts() {
  $("#territorySearch").addEventListener("input", () => {
    setTerritoryPage(0);
    drawTerritory();
  });
  $("#territoryPrev").addEventListener("click", () => {
    setTerritoryPage(Math.max(0, territoryPage - 1));
    drawTerritory();
  });
  $("#territoryNext").addEventListener("click", () => {
    setTerritoryPage(territoryPage + 1);
    drawTerritory();
  });
  $("#territoryBody").addEventListener("change", (e) => {
    const center = e.target.dataset.districtCenter;
    if (center == null) return;
    const d = S.districtById.get(+center),
      ci = e.target.value === "" ? null : +e.target.value;
    if (!d) return;
    d.centerCity = ci;
    const r = S.regions[d.regionId];
    if (r && r.center == null && ci != null) r.center = ci;
    logEv(
      ci == null
        ? "В районе " + (+center + 1) + " снят районный центр"
        : "Районный центр района " + (+center + 1) + ": " + S.cities[ci].name,
    );
    evaluate();
    render();
  });
  document.addEventListener("pointerdown", (e) => {
    const popup = $("#territoryPopup");
    if (!popup.hidden && !popup.contains(e.target) && !(e.target as HTMLElement).closest("#region"))
      popup.hidden = true;
  });
  $("#territoryPopup").addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-district-claim]");
    if (!b) return;
    const id = +$("#territoryPopup").dataset.id;
    if (S.districtById.has(id)) return;
    const near = nearestMajorCityToDistrict(id),
      cost = 15 + (near ? Math.ceil(near.km / 10) : 0);
    if (!spend(cost, "territory")) {
      flash("Нужно " + fmtM(cost) + " для присоединения района.");
      return;
    }
    const component = districtLandComponent(id),
      fits = (r) =>
        !(r.districts || []).some((other) => districtLandComponent(other) !== component) &&
        !(r.center != null && cityLandComponent(r.center) !== component) &&
        !(r.manualCities || []).some((ci) => cityLandComponent(ci) !== component);
    let ri = S.regions.findIndex(fits);
    if (ri < 0) {
      ri = S.regions.length;
      S.regions.push({
        name: "Регион " + (ri + 1),
        color: DCOL[ri % DCOL.length],
        cities: [],
        center: null,
        manualCities: [],
        districts: [],
      });
    }
    const d = claimDistrict(id, ri);
    makeRuralSites(S.seed, S.ruralPool);
    logEv(
      "К государству присоединён район " +
        (id + 1) +
        " · " +
        fmtM(cost) +
        " · регион «" +
        S.regions[d.regionId].name +
        "»",
    );
    DIST.key = "";
    evaluate();
    render();
    showDistrictPopup(id);
  });
  $("#territoryPopup").addEventListener("change", (e) => {
    if (!e.target.matches("[data-district-popup-region]")) return;
    const id = +$("#territoryPopup").dataset.id,
      value = e.target.value;
    let ri;
    if (value === "new") {
      ri = S.regions.length;
      S.regions.push({
        name: "Регион " + (ri + 1),
        color: DCOL[ri % DCOL.length],
        cities: [],
        center: null,
        manualCities: [],
        districts: [],
      });
    } else ri = +value;
    if (!assignDistrictRegion(id, ri)) {
      flash("Регион должен находиться на той же суше.");
      showDistrictPopup(id);
      return;
    }
    logEv("Район " + (id + 1) + " переведён в регион «" + S.regions[ri].name + "»");
    evaluate();
    render();
    $("#territoryPopup").hidden = true;
  });
  $("#dbody").addEventListener("change", (e) => {
    const i = e.target.dataset.dc;
    if (i == null) return;
    const d = S.regions[+i];
    if (!d) return;
    const next = +e.target.value;
    if (S.planet) {
      const cc = cityLandComponent(next);
      if (d.manualCities.some((ci) => cityLandComponent(ci) !== cc)) {
        e.target.value = String(d.center);
        flash("Область не может объединять сушу через море.");
        return;
      }
    }
    d.center = next;
    logEv("Центр области «" + d.name + "»: " + S.cities[d.center].name);
    ZONE.key = "";
    DIST.key = "";
    evaluate();
    render();
  });
  $("#dbody").addEventListener("input", (e) => {
    const i = e.target.dataset.i;
    if (i == null) return;
    const d = S.regions[+i];
    if (d) {
      d.name = e.target.value || "Регион";
      drawRegion();
    }
  });
  $("#dbody").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]"),
      ed = e.target.closest("[data-edit]");
    if (del) {
      S.regions.splice(+del.dataset.del, 1);
      if (dPick != null) setDPick(null);
      $("#dbody").dataset.n = "";
      DIST.key = "";
      evaluate();
      toolButtons();
      render();
    } else if (ed) {
      setRdraw(null);
      setFounding(false);
      setDPick(+ed.dataset.edit);
      toolButtons();
      render();
    }
  });
}
