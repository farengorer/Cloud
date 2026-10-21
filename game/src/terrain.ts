import { monthRate } from "./actions";
import { smoothstep } from "./colors";
import {
  DEP_T,
  PORT_CAPACITY,
  PORT_MAX_LEVEL,
  RH,
  RIVER_PORT_REACH,
  RW,
  SEA_PORT_REACH,
} from "./config";
import { DCOL } from "./districts";
import { GOODS, zeroGoods } from "./economy";
import { dist, geoXY, nearX, wrapX } from "./model";
import { DEP_RES } from "./resources";
import {
  RIVER_INDEX,
  RIVER_INDEX_T,
  RIVER_STAMP,
  S,
  SEA_ROUTE_GRID,
  rng,
  setRIVER_INDEX,
  setRIVER_INDEX_T,
  setRIVER_STAMP,
  setSEA_ROUTE_GRID,
} from "./state";
import { clamp, fbm, makeNoise, mulberry32, segDist, wrappedFbm, wrappedNoise } from "./util";
import { isIceAt, mtVal, seaD } from "./worldgen";

export function makeTerrain() {
  const T: Record<string, any> = {
    nF: makeNoise(rng),
    nE: makeNoise(rng),
    nD: makeNoise(rng),
    nS: makeNoise(rng),
    rivers: [],
    deps: [],
  };
  let y = RH * (0.24 + rng() * 0.52),
    dy = 0;
  const main = [],
    riverStep = RW / 256;
  for (let x = -riverStep; x <= RW + riverStep; x += riverStep) {
    main.push([x, y]);
    dy = dy * 0.6 + (rng() - 0.5) * RH * 0.003;
    y = clamp(y + dy, RH * 0.15, RH * 0.85);
  }
  const seamShift = main[main.length - 1][1] - main[0][1];
  main.forEach((p, i) => (p[1] -= (seamShift * i) / (main.length - 1)));
  T.rivers.push({ pts: main, w: 0.38 });
  const jx = RW * (0.3 + rng() * 0.4),
    ji = Math.round((jx + riverStep) / riverStep),
    jp = main[clamp(ji, 1, main.length - 2)],
    up = jp[1] > RH / 2 ? -1 : 1;
  const trib = [[jp[0], jp[1]]];
  let tx = jp[0],
    ty = jp[1],
    dx = 0;
  while (ty > -RH * 0.02 && ty < RH * 1.02) {
    dx = dx * 0.6 + (rng() - 0.5) * RW * 0.001;
    tx = clamp(tx + dx, 10, RW - 10);
    ty += (up * RH) / 256;
    trib.push([tx, ty]);
  }
  T.rivers.push({ pts: trib, w: 0.25 });
  const nt = Math.floor(rng() * 3);
  for (let q = 0; q < nt; q++) {
    const jp2 = main[clamp(Math.floor(rng() * main.length), 1, main.length - 2)],
      dir = rng() < 0.5 ? -1 : 1;
    const tr = [[jp2[0], jp2[1]]];
    let x2 = jp2[0],
      y2 = jp2[1],
      d2 = 0,
      steps = 8 + Math.floor(rng() * 20);
    for (let k = 0; k < steps; k++) {
      d2 = d2 * 0.6 + (rng() - 0.5) * RW * 0.0007;
      x2 = clamp(x2 + d2, 10, RW - 10);
      y2 += (dir * RH) / 256;
      tr.push([x2, y2]);
      if (y2 < -RH * 0.02 || y2 > RH * 1.02) break;
    }
    T.rivers.push({ pts: tr, w: 0.18 });
  }
  T.lakes = [];
  const nl = Math.floor(rng() * 6);
  for (let q = 0; q < nl; q++)
    T.lakes.push({ x: 30 + rng() * (RW - 60), y: 30 + rng() * (RH - 60), r: 1.5 + rng() * 4.5 });
  T.fOff = (rng() - 0.5) * 0.12;
  T.sOff = (rng() - 0.5) * 0.1;
  return T;
}
const RIVER_BIN = 4;
function riverIndex() {
  if (RIVER_INDEX_T === S.T && RIVER_INDEX) return RIVER_INDEX;
  const bins = new Map(),
    put = (x, y, seg) => {
      const gx = Math.floor(wrapX(x) / RIVER_BIN),
        gy = Math.floor(y / RIVER_BIN),
        key = gy + ":" + gx;
      let a = bins.get(key);
      if (!a) bins.set(key, (a = []));
      a.push(seg);
    };
  S.T.rivers.forEach((r) => {
    const p = r.drawPts || r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i],
        b = p[i + 1],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = Math.hypot(dx, dy),
        n = Math.max(1, Math.ceil(len / 1.25)),
        seg = { ax: a[0], ay: a[1], bx: b[0], by: b[1], w: r.w };
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        put(a[0] + dx * t, a[1] + dy * t, seg);
      }
    }
  });
  setRIVER_INDEX_T(S.T);
  setRIVER_INDEX(bins);
  return bins;
}
export function riverWaterAt(x, y) {
  const bins = riverIndex(),
    gx = Math.floor(wrapX(x) / RIVER_BIN),
    gy = Math.floor(y / RIVER_BIN),
    stamp = setRIVER_STAMP(RIVER_STAMP + 1);
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const col = (gx + ox + Math.ceil(RW / RIVER_BIN)) % Math.ceil(RW / RIVER_BIN),
        a = bins.get(gy + oy + ":" + col);
      if (!a) continue;
      for (const seg of a) {
        if (seg.stamp === stamp) continue;
        seg.stamp = stamp;
        let ax = seg.ax,
          bx = seg.bx;
        if (S.planet) {
          const shift = Math.round((x - (ax + bx) / 2) / RW) * RW;
          ax += shift;
          bx += shift;
        }
        if (segDist(x, y, ax, seg.ay, bx, seg.by) <= seg.w) return true;
      }
    }
  for (const l of S.T.lakes || []) {
    const dx = S.planet ? Math.min(Math.abs(x - l.x), RW - Math.abs(x - l.x)) : x - l.x;
    if (Math.hypot(dx, y - l.y) <= l.r) return true;
  }
  return false;
}
export function riverDist(x, y, noSea?) {
  let m = 3.01;
  const bins = riverIndex(),
    gx = Math.floor(wrapX(x) / RIVER_BIN),
    gy = Math.floor(y / RIVER_BIN),
    stamp = setRIVER_STAMP(RIVER_STAMP + 1),
    cols = Math.ceil(RW / RIVER_BIN),
    maxRing = 2;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let oy = -ring; oy <= ring; oy++)
      for (let ox = -ring; ox <= ring; ox++) {
        if (ring && Math.abs(ox) !== ring && Math.abs(oy) !== ring) continue;
        const ny = gy + oy,
          col = (gx + ox + cols) % cols,
          segs = bins.get(ny + ":" + col);
        if (!segs) continue;
        for (const seg of segs) {
          if (seg.stamp === stamp) continue;
          seg.stamp = stamp;
          let ax = seg.ax,
            bx = seg.bx;
          if (S.planet) {
            const shift = Math.round((x - (ax + bx) / 2) / RW) * RW;
            ax += shift;
            bx += shift;
          }
          const d = segDist(x, y, ax, seg.ay, bx, seg.by) - seg.w;
          if (d < m) m = d;
        }
      }
    if (m < 0 || m <= (ring + 1) * RIVER_BIN - Math.SQRT2 * RIVER_BIN) break;
  }
  for (const l of S.T.lakes || []) {
    const dx = S.planet ? Math.min(Math.abs(x - l.x), RW - Math.abs(x - l.x)) : x - l.x,
      d = Math.hypot(dx, y - l.y) - l.r;
    if (d < m) m = d;
  }
  if (!noSea && S.T.sea) {
    const sd = seaD(x, y);
    if (sd < m) m = sd;
  }
  return m;
}
export function riverChannelDist(x, y) {
  let m = 1e9;
  for (const r of S.T.rivers) {
    const p = r.drawPts || r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      let ax = p[i][0],
        bx = p[i + 1][0];
      if (S.planet) {
        const shift = Math.round((x - (ax + bx) / 2) / RW) * RW;
        ax += shift;
        bx += shift;
      }
      m = Math.min(m, segDist(x, y, ax, p[i][1], bx, p[i + 1][1]) - r.w);
    }
  }
  return m;
}
export function portLevel(c, type) {
  return clamp(
    Math.floor(+c[type === "sea" ? "seaPortLevel" : "riverPortLevel"] || 0),
    0,
    PORT_MAX_LEVEL,
  );
}
export function portCapacity(c, type) {
  return PORT_CAPACITY[type][portLevel(c, type)] || 0;
}
function totalPortCapacity(cities) {
  return (cities || S.cities).reduce(
    (n, c) => n + portCapacity(c, "sea") + portCapacity(c, "river"),
    0,
  );
}
function coastDistanceKm(x, y, raw) {
  const sea = S.T.sea;
  if (raw == null) raw = seaD(x, y);
  if (!sea || raw < 0) return raw;
  if (!S.planet || !sea.planet) return raw;
  let px = wrapX(x),
    py = clamp(y, 1, RH - 1),
    d = raw,
    total = 0,
    g = 1;
  for (let n = 0; n < 72; n++) {
    const h = 12,
      xp = seaD(wrapX(px + h), py),
      xm = seaD(wrapX(px - h), py),
      ya = Math.max(1, py - h),
      yb = Math.min(RH - 1, py + h),
      yp = seaD(px, yb),
      ym = seaD(px, ya),
      gx = (xp - xm) / (2 * h),
      gy = (yp - ym) / (yb - ya),
      cos = Math.max(0.08, Math.cos((0.5 - py / RH) * Math.PI)),
      ge = gx / cos;
    g = Math.hypot(ge, gy);
    if (!Number.isFinite(g)) return total + d;
    if (g < 0.04) return total + d / 0.25;
    const remain = d / g;
    if (remain <= 25) return total + remain;
    let travel = Math.min(250, remain * 0.32),
      nx = px,
      ny = py,
      nd = d;
    for (let retry = 0; retry < 5; retry++) {
      nx = wrapX(px - (ge / (g * cos)) * travel);
      ny = clamp(py - (gy / g) * travel, 1, RH - 1);
      nd = seaD(nx, ny);
      if (nd < d - 0.1 || nd <= 0) break;
      travel *= 0.5;
    }
    if (nd <= 0) {
      const dx = nearX(nx, px) - px,
        dy = ny - py;
      let lo = 0,
        hi = 1;
      for (let j = 0; j < 14; j++) {
        const mid = (lo + hi) * 0.5;
        if (seaD(wrapX(px + dx * mid), py + dy * mid) > 0) lo = mid;
        else hi = mid;
      }
      return total + travel * hi;
    }
    if (!(nd < d - 0.1)) return total + remain;
    total += travel;
    px = nx;
    py = ny;
    d = nd;
  }
  return total + d / (Number.isFinite(g) ? Math.max(g, 0.25) : 1);
}
export function seaPortAccess(x, y) {
  const raw = seaD(x, y),
    dist = coastDistanceKm(x, y, raw);
  return { ok: !!S.T.sea && raw >= 0 && dist <= SEA_PORT_REACH, dist };
}
export function riverPortAccess(x, y) {
  const d = riverChannelDist(x, y);
  return { ok: d <= RIVER_PORT_REACH, dist: d };
}
export function portLevelName(level) {
  return ["нет", "I", "II", "III", "IV", "V"][level] || "V";
}
export function hasCargoPort(c) {
  return portLevel(c, "sea") > 0 || portLevel(c, "river") > 0;
}
function riverProjection(x, y, pts, shift) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0] + shift,
      ay = pts[i][1],
      bx = pts[i + 1][0] + shift,
      by = pts[i + 1][1],
      dx = bx - ax,
      dy = by - ay,
      t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1),
      px = ax + dx * t,
      py = ay + dy * t,
      d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { i, t, x: px, y: py, d };
  }
  return best;
}
export function riverCargoPath(a, b) {
  let best = null;
  for (let ri = 0; ri < S.T.rivers.length; ri++) {
    const pts = S.T.rivers[ri].drawPts || S.T.rivers[ri].pts;
    if (pts.length < 2) continue;
    const mid = pts.reduce((n, p) => n + p[0], 0) / pts.length,
      base = Math.round(((a.x + b.x) / 2 - mid) / RW) * RW;
    for (let shift = base - RW; shift <= base + RW; shift += RW) {
      const pa = riverProjection(a.x, a.y, pts, shift),
        pb = riverProjection(nearX(b.x, a.x), b.y, pts, shift),
        score = pa.d + pb.d;
      if ((!best || score < best.score) && pa.d <= RIVER_PORT_REACH && pb.d <= RIVER_PORT_REACH)
        best = { ri, pts, shift, pa, pb, score };
    }
  }
  if (!best) return null;
  let ia = best.pa.i + best.pa.t,
    ib = best.pb.i + best.pb.t,
    out = [
      [a.x, a.y],
      [best.pa.x, best.pa.y],
    ];
  if (ia <= ib) {
    for (let i = Math.floor(ia) + 1; i <= Math.floor(ib); i++)
      out.push([best.pts[i][0] + best.shift, best.pts[i][1]]);
  } else {
    for (let i = Math.ceil(ia) - 1; i >= Math.ceil(ib); i--)
      out.push([best.pts[i][0] + best.shift, best.pts[i][1]]);
  }
  out.push([best.pb.x, best.pb.y], [nearX(b.x, a.x), b.y]);
  return { river: best.ri, points: out };
}
function seaGrid() {
  if (SEA_ROUTE_GRID && SEA_ROUTE_GRID.terrain === S.T) return SEA_ROUTE_GRID;
  setSEA_ROUTE_GRID({ terrain: S.T, nx: 320, ny: 160, water: new Map() });
  return SEA_ROUTE_GRID;
}
function seaCellWater(gx, gy, g) {
  if (gy < 0 || gy >= g.ny) return false;
  gx = ((gx % g.nx) + g.nx) % g.nx;
  const id = gy * g.nx + gx;
  if (g.water.has(id)) return g.water.get(id);
  const v = seaD(((gx + 0.5) * RW) / g.nx, ((gy + 0.5) * RH) / g.ny) < 0;
  g.water.set(id, v);
  return v;
}
function nearestSeaCell(x, y, g) {
  const cx = Math.floor((wrapX(x) / RW) * g.nx),
    cy = clamp(Math.floor((y / RH) * g.ny), 0, g.ny - 1);
  let best = null;
  for (let r = 0; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const gx = (cx + dx + g.nx) % g.nx,
          gy = cy + dy;
        if (!seaCellWater(g, gx, gy)) continue;
        const px = ((gx + 0.5) * RW) / g.nx,
          py = ((gy + 0.5) * RH) / g.ny,
          d = geoXY(x, y, px, py);
        if (!best || d < best.d) best = { gx, gy, id: gy * g.nx + gx, x: px, y: py, d };
      }
  return best;
}
export function seaCargoPath(a, b) {
  const g = seaGrid(),
    start = nearestSeaCell(a.x, a.y, g),
    end = nearestSeaCell(nearX(b.x, a.x), b.y, g);
  if (!start || !end) return null;
  const size = g.nx * g.ny,
    score = new Float64Array(size),
    parent = new Int32Array(size),
    closed = new Uint8Array(size);
  score.fill(Infinity);
  parent.fill(-1);
  score[start.id] = 0;
  const heap = [];
  function push(id, f) {
    let i = heap.length;
    heap.push({ id, f });
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= f) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = { id, f };
  }
  function pop() {
    const root = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        let l = i * 2 + 1,
          r = l + 1;
        if (l >= heap.length) break;
        let c = r < heap.length && heap[r].f < heap[l].f ? r : l;
        if (heap[c].f >= last.f) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return root;
  }
  const pos = (id) => [
      (((id % g.nx) + 0.5) * RW) / g.nx,
      ((Math.floor(id / g.nx) + 0.5) * RH) / g.ny,
    ],
    heur = (id) => {
      const p = pos(id);
      return geoXY(p[0], p[1], end.x, end.y);
    };
  push(start.id, heur(start.id));
  let found = false,
    visited = 0;
  while (heap.length && visited < size) {
    const q = pop(),
      id = q.id;
    if (closed[id]) continue;
    closed[id] = 1;
    visited++;
    if (id === end.id) {
      found = true;
      break;
    }
    const gx = id % g.nx,
      gy = Math.floor(id / g.nx),
      p = pos(id);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = gy + dy,
          nx = (gx + dx + g.nx) % g.nx;
        if (!seaCellWater(g, nx, ny)) continue;
        const ni = ny * g.nx + nx;
        if (closed[ni]) continue;
        const np = pos(ni),
          stepKm = Math.hypot(
            ((dx * RW) / g.nx) * Math.max(0.08, Math.cos((p[1] / RH - 0.5) * Math.PI)),
            (dy * RH) / g.ny,
          ),
          depth = Math.max(0, seaD(np[0], np[1])),
          cost = stepKm * (1 + 0.25 * Math.exp(-depth / 30)),
          ng = score[id] + cost;
        if (ng < score[ni]) {
          score[ni] = ng;
          parent[ni] = id;
          push(ni, ng + heur(ni));
        }
      }
  }
  if (!found) return null;
  const route = [];
  for (let id = end.id; id !== -1; id = parent[id]) {
    route.push(pos(id));
    if (id === start.id) break;
  }
  route.reverse();
  const pts = [[a.x, a.y]];
  for (const p of route) {
    let x = nearX(p[0], pts[pts.length - 1][0]);
    if (Math.hypot(x - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1)
      pts.push([x, p[1]]);
  }
  pts.push([nearX(b.x, pts[pts.length - 1][0]), b.y]);
  return pts;
}
export function cargoRouteCost(type, a, b) {
  const km = dist(S.cities[a], S.cities[b]);
  return type === "sea" ? 0.14 + km * 0.000012 : 0.08 + km * 0.00002;
}
export function cargoRouteStats(r) {
  const a = S.cities[r.a],
    b = S.cities[r.b];
  if (!a || !b) return null;
  const type = r.type === "river" ? "river" : "sea",
    raw = Math.min(portCapacity(a, type), portCapacity(b, type)),
    pts = r.points || [];
  let km = 0;
  if (pts.length > 1) {
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1],
        q = pts[i];
      km += S.planet ? geoXY(p[0], p[1], q[0], q[1]) : Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
  } else km = dist(a, b);
  const factor =
    type === "sea" ? clamp(0.95 - km / 180000, 0.55, 0.95) : clamp(0.95 - km / 22000, 0.4, 0.95);
  return { type, km, capacity: raw * factor };
}
export function settleCargoFlows() {
  const routes = S.cargoRoutes || [],
    cs = S.cities,
    remainingOut = cs.map((c) => Object.assign({}, c.goodsOut || zeroGoods())),
    remainingNeed = cs.map((c) => Object.assign({}, c.goodsUse || zeroGoods())),
    movedOut = cs.map(() => zeroGoods()),
    movedIn = cs.map(() => zeroGoods()),
    loads = new Map();
  routes.forEach((r) => {
    const st = cargoRouteStats(r);
    if (!st) return;
    for (const i of [r.a, r.b]) {
      const key = st.type + ":" + i;
      loads.set(key, (loads.get(key) || 0) + st.capacity);
    }
  });
  const caps = routes.map((r) => {
    const st = cargoRouteStats(r);
    if (!st) return 0;
    const fa = Math.min(
        1,
        portCapacity(cs[r.a], st.type) / Math.max(1, loads.get(st.type + ":" + r.a)),
      ),
      fb = Math.min(
        1,
        portCapacity(cs[r.b], st.type) / Math.max(1, loads.get(st.type + ":" + r.b)),
      );
    return st.capacity * Math.min(fa, fb);
  });
  routes.forEach((r, ri) => {
    let left = caps[ri];
    const a = r.a,
      b = r.b,
      flows = [];
    for (const g in GOODS) {
      if (left <= 0) break;
      const mass = GOODS[g].tonnes,
        exA = Math.max(0, remainingOut[a][g] - remainingNeed[a][g]),
        needB = Math.max(0, remainingNeed[b][g] - remainingOut[b][g]),
        exB = Math.max(0, remainingOut[b][g] - remainingNeed[b][g]),
        needA = Math.max(0, remainingNeed[a][g] - remainingOut[a][g]);
      let units = Math.min(exA, needB, left / mass);
      if (units > 0) {
        flows.push({
          good: g,
          from: a,
          to: b,
          units,
          tonnes: units * mass,
          value: units * S.prices[g],
        });
        remainingOut[a][g] -= units;
        remainingNeed[b][g] -= units;
        movedOut[a][g] += units;
        movedIn[b][g] += units;
        left -= units * mass;
      }
      units = Math.min(exB, needA, left / mass);
      if (units > 0) {
        flows.push({
          good: g,
          from: b,
          to: a,
          units,
          tonnes: units * mass,
          value: units * S.prices[g],
        });
        remainingOut[b][g] -= units;
        remainingNeed[a][g] -= units;
        movedOut[b][g] += units;
        movedIn[a][g] += units;
        left -= units * mass;
      }
    }
    r.flows = flows;
    r.annualTonnes = flows.reduce((n, f) => n + f.tonnes, 0);
    r.monthlyTonnes = r.annualTonnes / 12;
    r.annualValue = flows.reduce((n, f) => n + f.value, 0);
    r.capacityUsed = caps[ri] - left;
  });
  const out = zeroGoods(),
    use = zeroGoods();
  cs.forEach((c, i) => {
    c.goodsShipped = movedOut[i];
    c.goodsReceived = movedIn[i];
    for (const g in GOODS) {
      out[g] += Math.max(0, remainingOut[i][g]);
      use[g] += Math.max(0, remainingNeed[i][g]);
    }
  });
  return { out, use, movedOut, movedIn };
}
export function totalCargoRouteCapacity() {
  const rows = (S.cargoRoutes || [])
      .map((r) => ({ r, st: cargoRouteStats(r) }))
      .filter((x) => x.st && x.st.capacity > 0),
    load = {};
  rows.forEach(({ r, st }) => {
    for (const i of [r.a, r.b]) {
      const k = st.type + ":" + i;
      load[k] = (load[k] || 0) + st.capacity;
    }
  });
  const factor = (i, t) =>
    Math.min(1, portCapacity(S.cities[i], t) / Math.max(1, load[t + ":" + i]));
  return rows.reduce(
    (n, { r, st }) => n + st.capacity * Math.min(factor(r.a, st.type), factor(r.b, st.type)),
    0,
  );
}
export function externalCargoCapacity() {
  const rows = (S.cargoRoutes || [])
      .map((r) => ({ r, st: cargoRouteStats(r) }))
      .filter((x) => x.st && x.st.capacity > 0),
    load = new Map(),
    used = new Map();
  rows.forEach(({ r, st }) => {
    for (const i of [r.a, r.b]) {
      const k = st.type + ":" + i;
      load.set(k, (load.get(k) || 0) + st.capacity);
    }
  });
  rows.forEach(({ r, st }) => {
    const factor = Math.min(
        1,
        portCapacity(S.cities[r.a], st.type) / Math.max(1, load.get(st.type + ":" + r.a)),
        portCapacity(S.cities[r.b], st.type) / Math.max(1, load.get(st.type + ":" + r.b)),
      ),
      q = st.capacity * factor;
    for (const i of [r.a, r.b]) {
      const k = st.type + ":" + i;
      used.set(k, (used.get(k) || 0) + q);
    }
  });
  return S.cities.reduce(
    (n, c, i) =>
      n +
      Math.max(0, portCapacity(c, "sea") - (used.get("sea:" + i) || 0)) +
      Math.max(0, portCapacity(c, "river") - (used.get("river:" + i) || 0)),
    0,
  );
}
export const BIOMES = [
  { name: "Океан", color: "#315e78", forest: -0.5, soil: -0.5 },
  { name: "Тундра", color: "#9bb9ad", forest: -0.34, soil: -0.08 },
  { name: "Тайга", color: "#28674d", forest: 0.25, soil: 0.02 },
  { name: "Умеренные леса", color: "#4e8a55", forest: 0.25, soil: 0.12 },
  { name: "Степи и саванны", color: "#b6a454", forest: -0.14, soil: 0.24 },
  { name: "Пустыни", color: "#d5a765", forest: -0.43, soil: -0.28 },
  { name: "Тропические леса", color: "#23836a", forest: 0.31, soil: 0.06 },
  { name: "Высокогорья", color: "#928f86", forest: -0.28, soil: -0.1 },
  { name: "Средиземноморские редколесья", color: "#a98255", forest: -0.02, soil: 0.05 },
];
function gridAt(a, x, y) {
  if (!a) return 0;
  const gx = Math.floor((wrapX(x) / RW) * a.W),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  return a.data[gy * a.W + gx] || 0;
}
export function tectonicAt(x, y) {
  const a = S && S.planet && S.T && S.T.tectonics;
  if (!a) return 0;
  const gx = Math.floor((wrapX(x) / RW) * a.W),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  return a.uplift[gy * a.W + gx] || 0;
}
export function riftAt(x, y) {
  const a = S && S.planet && S.T && S.T.tectonics;
  if (!a) return 0;
  const gx = Math.floor((wrapX(x) / RW) * a.W),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  return a.rift[gy * a.W + gx] || 0;
}
function smoothTectonicField(field, x, y) {
  const a = S && S.planet && S.T && S.T.tectonics;
  if (!a || !field) return 0;
  const fx = (wrapX(x) / RW) * a.W - 0.5,
    fy = clamp((y / RH) * a.H - 0.5, 0, a.H - 1),
    ix = Math.floor(fx),
    iy = Math.floor(fy),
    tx = fx - ix,
    ty = fy - iy,
    x0 = (ix + a.W) % a.W,
    x1 = (x0 + 1) % a.W,
    y0 = clamp(iy, 0, a.H - 1),
    y1 = Math.min(a.H - 1, y0 + 1),
    v00 = field[y0 * a.W + x0],
    v10 = field[y0 * a.W + x1],
    v01 = field[y1 * a.W + x0],
    v11 = field[y1 * a.W + x1];
  return (v00 + (v10 - v00) * tx) * (1 - ty) + (v01 + (v11 - v01) * tx) * ty;
}
export function reliefHeightAt(x, y, sd?) {
  if (!S || !S.planet || !S.T.tectonics) return 0;
  if (sd == null) sd = seaD(x, y);
  if (sd < 0 || isIceAt(x, y)) return 0;
  const landSoft = smoothstep(-40, 190, sd),
    landWide = smoothstep(-180, 520, sd),
    land = clamp(0.68 * landSoft + 0.32 * landWide, 0, 1),
    u = smoothTectonicField(S.T.tectonics.uplift, x, y),
    div = smoothTectonicField(S.T.tectonics.rift, x, y),
    nMacro = (wrappedNoise(S.T.nE, x, y, 900) - 0.5) * 5.2,
    nLarge = (wrappedNoise(S.T.nD, x, y, 330) - 0.5) * 5.2,
    nMed = (wrappedNoise(S.T.nS, x, y, 135) - 0.5) * 5.2,
    nCoast = (wrappedNoise(S.T.nF, x, y, 72) - 0.5) * 5.2;
  const belt = smoothstep(0.04, 0.34, u) * land,
    core = smoothstep(0.3, 0.6, u) * land,
    crest = smoothstep(0.56, 0.86, u) * land,
    rough = 0.62 * Math.abs(nMed) + 0.38 * Math.abs(nCoast);
  let h = 130 + 300 * land + 85 * nMacro + 48 * nLarge + 13 * nMed + 4 * nCoast;
  h += 880 * Math.pow(belt, 0.92) + 1320 * Math.pow(core, 1.28) + 1850 * Math.pow(crest, 2.05);
  h +=
    (110 * Math.abs(nLarge) + 72 * Math.max(nMed, 0) + 38 * Math.max(nCoast, 0)) * belt +
    105 * core * clamp(rough, 0, 1.25) -
    190 * div * land;
  return clamp(h, 0, 5900) / 5900;
}
function plateTypeAt(x, y) {
  const a = S && S.planet && S.T && S.T.tectonics;
  if (!a || !S.T.plates) return "океаническая";
  const gx = Math.floor((wrapX(x) / RW) * a.W),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1),
    id = a.plate[gy * a.W + gx];
  return S.T.plates[id] ? S.T.plates[id].kind : "океаническая";
}
function biomeAt(x, y) {
  const a = S && S.planet && S.T && S.T.biomeGrid;
  if (!a) return 0;
  const gx = Math.floor((wrapX(x) / RW) * a.W),
    gy = clamp(Math.floor((y / RH) * a.H), 0, a.H - 1);
  return a.data[gy * a.W + gx] || 0;
}
export function forestVal(x, y) {
  const base =
    (S.planet ? wrappedFbm(S.T.nF, x, y, 20) : fbm(S.T.nF, x / 20, y / 20)) +
    0.12 * ((S.planet ? wrappedNoise(S.T.nD, x, y, 1.1) : S.T.nD(x * 0.9, y * 0.9)) - 0.5) +
    (S.T.fOff || 0) +
    (S.T.fOff2 || 0);
  return S.planet && S.T.biomeGrid ? base + BIOMES[biomeAt(x, y)].forest : base;
}
export function soilVal(x, y) {
  const base =
    (S.planet ? wrappedFbm(S.T.nS, x, y, 30) : fbm(S.T.nS, x / 30, y / 30)) +
    (S.T.sOff || 0) +
    (S.T.sOff2 || 0);
  return S.planet && S.T.biomeGrid ? base + BIOMES[biomeAt(x, y)].soil : base;
}
export function elevVal(x, y) {
  return S.planet
    ? reliefHeightAt(x, y)
    : fbm(S.T.nE, x / 26, y / 26) +
        (S.T.tectonics
          ? tectonicAt(x, y) * 1.25 - riftAt(x, y) * 0.28
          : S.T.ridge
            ? 0.55 * mtVal(x, y)
            : 0);
}
export function areaShares(x, y) {
  let n = 0,
    f = 0,
    s = 0;
  for (let dx = -8; dx <= 8; dx += 2)
    for (let dy = -8; dy <= 8; dy += 2) {
      if (dx * dx + dy * dy > 64) continue;
      n++;
      const fv = forestVal(x + dx, y + dy) > 0.6;
      if (fv) f++;
      else if (soilVal(x + dx, y + dy) > 0.55) s++;
    }
  return { forest: f / n, soil: s / n };
}
export function placeDeposits() {
  const d = [];
  let guard = 0;
  const target = S.planet ? 90 : 26,
    minSpacing = S.planet ? 420 : 38;
  while (d.length < target && guard++ < target * 700) {
    let x, y;
    if (S.planet) {
      x = rng() * RW;
      const lat = Math.asin(2 * rng() - 1);
      y = RH * (0.5 - lat / Math.PI);
    } else {
      x = 20 + rng() * (RW - 40);
      y = 20 + rng() * (RH - 40);
    }
    if (S.planet && (seaD(x, y) < 5 || isIceAt(x, y))) continue;
    if (riverDist(x, y, 1) < 3) continue;
    if (
      d.some((o) => (S.planet ? geoXY(o.x, o.y, x, y) : Math.hypot(o.x - x, y - o.y)) < minSpacing)
    )
      continue;
    let ty;
    if (S.planet) {
      const b = biomeAt(x, y),
        u = tectonicAt(x, y),
        basin = 1 - wrappedFbm(S.T.nS, x, y, 240),
        wet = [2, 3, 6].includes(b) ? 1 : 0.35,
        weights = [
          0.12 + basin * (b === 5 ? 0.95 : 0.56),
          0.1 + basin * (b === 5 ? 0.8 : 0.42),
          0.12 + wet * 0.72,
          0.08 + u * 1.05,
          0.08 + u * 0.9,
          0.07 + u * 1.1,
          0.08 + (b === 5 ? 0.85 : 0.18) + basin * 0.32,
          0.12 + u * 0.62,
          0.04 + u * 0.82,
        ];
      let pick = rng() * weights.reduce((a, v) => a + v, 0);
      let i = 0;
      for (; i < weights.length - 1 && pick >= weights[i]; i++) pick -= weights[i];
      ty = DEP_T[i];
    } else ty = DEP_T[Math.floor(rng() * DEP_T.length)];
    d.push({ x, y, k: ty.k, t: ty.t, used: 0, res: DEP_RES[ty.k] });
  }
  S.T.deps = d;
}
const COUNTRY_CULTURES = [
  {
    id: "RU",
    culture: "Россия",
    capital: "Москва",
    cities: [
      "Москва",
      "Санкт-Петербург",
      "Новосибирск",
      "Екатеринбург",
      "Казань",
      "Нижний Новгород",
      "Самара",
      "Омск",
      "Челябинск",
      "Ростов-на-Дону",
      "Уфа",
      "Владивосток",
      "Красноярск",
      "Пермь",
      "Воронеж",
      "Волгоград",
      "Саратов",
      "Тюмень",
      "Иркутск",
      "Хабаровск",
      "Ярославль",
      "Томск",
      "Калининград",
      "Сочи",
    ],
  },
  {
    id: "RS",
    culture: "Сербия",
    capital: "Белград",
    cities: [
      "Белград",
      "Нови-Сад",
      "Ниш",
      "Крагуевац",
      "Суботица",
      "Зренянин",
      "Панчево",
      "Чачак",
      "Кралево",
      "Смедерево",
      "Лесковац",
      "Валево",
      "Крушевац",
      "Ужице",
      "Шабац",
      "Вранье",
    ],
  },
  {
    id: "PL",
    culture: "Польша",
    capital: "Варшава",
    cities: [
      "Варшава",
      "Краков",
      "Лодзь",
      "Вроцлав",
      "Познань",
      "Гданьск",
      "Щецин",
      "Люблин",
      "Быдгощ",
      "Белосток",
      "Катовице",
      "Гдыня",
      "Ченстохова",
      "Торунь",
      "Жешув",
      "Кельце",
      "Ольштын",
      "Зелёна-Гура",
      "Ополе",
      "Гливице",
    ],
  },
  {
    id: "GB",
    culture: "Великобритания",
    capital: "Лондон",
    cities: [
      "Лондон",
      "Бирмингем",
      "Манчестер",
      "Глазго",
      "Ливерпуль",
      "Лидс",
      "Бристоль",
      "Шеффилд",
      "Эдинбург",
      "Лестер",
      "Ковентри",
      "Кардифф",
      "Белфаст",
      "Ноттингем",
      "Саутгемптон",
      "Ньюкасл",
      "Оксфорд",
      "Кембридж",
      "Йорк",
      "Абердин",
    ],
  },
  {
    id: "FR",
    culture: "Франция",
    capital: "Париж",
    cities: [
      "Париж",
      "Марсель",
      "Лион",
      "Тулуза",
      "Ницца",
      "Нант",
      "Страсбург",
      "Монпелье",
      "Бордо",
      "Лилль",
      "Ренн",
      "Реймс",
      "Гренобль",
      "Дижон",
      "Тулон",
      "Ним",
      "Анже",
      "Тур",
      "Кан",
      "Руан",
    ],
  },
  {
    id: "DE",
    culture: "Германия",
    capital: "Берлин",
    cities: [
      "Берлин",
      "Гамбург",
      "Мюнхен",
      "Кёльн",
      "Франкфурт-на-Майне",
      "Штутгарт",
      "Дюссельдорф",
      "Лейпциг",
      "Дортмунд",
      "Эссен",
      "Бремен",
      "Дрезден",
      "Ганновер",
      "Нюрнберг",
      "Бонн",
      "Мангейм",
      "Карлсруэ",
      "Аугсбург",
      "Мюнстер",
      "Фрайбург",
    ],
  },
  {
    id: "IT",
    culture: "Италия",
    capital: "Рим",
    cities: [
      "Рим",
      "Милан",
      "Неаполь",
      "Турин",
      "Палермо",
      "Генуя",
      "Болонья",
      "Флоренция",
      "Бари",
      "Катания",
      "Верона",
      "Венеция",
      "Мессина",
      "Падуя",
      "Триест",
      "Брешиа",
      "Парма",
      "Модена",
      "Перуджа",
      "Пиза",
    ],
  },
  {
    id: "US",
    culture: "США",
    capital: "Вашингтон",
    cities: [
      "Вашингтон",
      "Нью-Йорк",
      "Лос-Анджелес",
      "Чикаго",
      "Хьюстон",
      "Финикс",
      "Филадельфия",
      "Сан-Антонио",
      "Сан-Диего",
      "Даллас",
      "Сан-Хосе",
      "Остин",
      "Джексонвилл",
      "Форт-Уэрт",
      "Колумбус",
      "Индианаполис",
      "Сан-Франциско",
      "Сиэтл",
      "Денвер",
      "Бостон",
      "Нэшвилл",
      "Портленд",
    ],
  },
  {
    id: "MX",
    culture: "Мексика",
    capital: "Мехико",
    cities: [
      "Мехико",
      "Гвадалахара",
      "Монтеррей",
      "Пуэбла",
      "Тихуана",
      "Леон",
      "Хуарес",
      "Сапопан",
      "Мерида",
      "Сан-Луис-Потоси",
      "Агуаскальентес",
      "Чиуауа",
      "Морелия",
      "Эрмосильо",
      "Оахака",
      "Керетаро",
      "Толука",
      "Кулиакан",
      "Веракрус",
      "Канкун",
    ],
  },
  {
    id: "AR",
    culture: "Аравия",
    capital: "Эр-Рияд",
    cities: [
      "Эр-Рияд",
      "Джидда",
      "Мекка",
      "Медина",
      "Даммам",
      "Таиф",
      "Табук",
      "Бурайда",
      "Абха",
      "Джизан",
      "Найран",
      "Янбу",
      "Хаиль",
      "Хамис-Мушайт",
      "Эль-Хуфуф",
    ],
  },
  {
    id: "TR",
    culture: "Турция",
    capital: "Анкара",
    cities: [
      "Анкара",
      "Стамбул",
      "Измир",
      "Бурса",
      "Анталья",
      "Адана",
      "Конья",
      "Газиантеп",
      "Мерсин",
      "Диярбакыр",
      "Самсун",
      "Денизли",
      "Эскишехир",
      "Трабзон",
      "Кайсери",
      "Шанлыурфа",
      "Малатья",
      "Ван",
      "Сивас",
      "Эдирне",
    ],
  },
  {
    id: "CN",
    culture: "Китай",
    capital: "Пекин",
    cities: [
      "Пекин",
      "Шанхай",
      "Гуанчжоу",
      "Шэньчжэнь",
      "Чэнду",
      "Чунцин",
      "Ухань",
      "Сиань",
      "Нанкин",
      "Ханчжоу",
      "Тяньцзинь",
      "Сучжоу",
      "Циндао",
      "Шэньян",
      "Харбин",
      "Куньмин",
      "Далянь",
      "Фучжоу",
      "Наньнин",
      "Чанша",
    ],
  },
  {
    id: "JP",
    culture: "Япония",
    capital: "Токио",
    cities: [
      "Токио",
      "Осака",
      "Киото",
      "Йокогама",
      "Нагоя",
      "Саппоро",
      "Кобе",
      "Фукуока",
      "Хиросима",
      "Сендай",
      "Нара",
      "Кавасаки",
      "Ниигата",
      "Сидзуока",
      "Канадзава",
      "Кумамото",
      "Окаяма",
      "Нагасаки",
      "Кагосима",
      "Мацумото",
    ],
  },
  {
    id: "IN",
    culture: "Индия",
    capital: "Нью-Дели",
    cities: [
      "Нью-Дели",
      "Мумбаи",
      "Колката",
      "Ченнаи",
      "Бангалор",
      "Хайдарабад",
      "Ахмадабад",
      "Пуна",
      "Джайпур",
      "Лакхнау",
      "Канпур",
      "Нагпур",
      "Индор",
      "Бхопал",
      "Кочи",
      "Патна",
      "Сурат",
      "Варанаси",
      "Агра",
      "Амритсар",
    ],
  },
];
export function cultureById(id) {
  return COUNTRY_CULTURES.find((c) => c.id === id) || COUNTRY_CULTURES[0];
}
function foreignCityPoint(e, cities, rr) {
  for (let t = 0; t < 220; t++) {
    const a = rr() * Math.PI * 2,
      r = 18 + rr() * Math.min(90, RW * 0.055),
      x = wrapX(e.gx + Math.cos(a) * r),
      y = clamp(e.gy + Math.sin(a) * r, RH * 0.16, RH * 0.84);
    if (
      seaD(x, y) < 5 ||
      isIceAt(x, y) ||
      geoXY(x, y, e.gx, e.gy) > Math.min(110, RW * 0.07) ||
      cities.some((c) => geoXY(x, y, c.x, c.y) < 14)
    )
      continue;
    return { x, y };
  }
  return { x: e.gx, y: e.gy };
}
export function makeExternal(count, home) {
  const rr = mulberry32((S.seed ^ 0x2e19a4c7) >>> 0),
    out = [],
    goods = Object.keys(GOODS);
  count = clamp(Math.round(+count || 0), 0, 12);
  const pool = COUNTRY_CULTURES.filter((c) => c.id !== S.cultureId).map((c) => ({
    data: c,
    names: c.cities.slice(),
  }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rr() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let tries = 0;
  while (out.length < count && tries++ < 30000) {
    const x = 10 + rr() * (RW - 20),
      y = RH * 0.13 + rr() * RH * 0.74;
    if (seaD(x, y) < 12 || isIceAt(x, y)) continue;
    if (home && geoXY(x, y, home.x, home.y) < Math.min(180, RW * 0.18)) continue;
    if (out.some((e) => geoXY(x, y, e.gx, e.gy) < Math.min(150, RW * 0.14))) continue;
    const k = out.length,
      pick = pool[k % pool.length],
      catalog = pick.data,
      pp = (0.8 + rr() * 5.2) * 1e6,
      g = goods[Math.floor(rr() * goods.length)],
      e = {
        name: catalog.culture,
        countryName: catalog.culture,
        culture: catalog.culture,
        cultureId: catalog.id,
        catalogId: catalog.id,
        x,
        y,
        gx: x,
        gy: y,
        P: pp,
        P0: pp,
        aiP: pp,
        base: 0.7 + rr() * 0.7,
        ext: true,
        k,
        A: 1,
        Arel: 1,
        tradeGood: g,
        color: DCOL[(k + 3) % DCOL.length],
        player: null,
        net: 0,
        cities: [],
        cityNames: pick.names.slice(1),
        growth: 0.003 + rr() * 0.006,
      };
    const initialCount = Math.min(e.cityNames.length, 2 + Math.floor(rr() * 3)),
      weights = [];
    for (let j = 0; j < initialCount; j++) weights.push(0.5 + rr() * 1.5);
    const total = weights.reduce((a, b) => a + b, 0);
    e.cities.push({
      name: catalog.capital,
      x,
      y,
      P: (pp * weights[0]) / total,
      P0: (pp * weights[0]) / total,
      growth: e.growth,
      capital: true,
    });
    for (let j = 1; j < initialCount; j++) {
      const p = foreignCityPoint(e, e.cities, rr),
        cityName = e.cityNames.shift(),
        cp = (pp * weights[j]) / total;
      e.cities.push({
        name: cityName,
        x: p.x,
        y: p.y,
        P: cp,
        P0: cp,
        growth: e.growth * (0.78 + rr() * 0.45),
        capital: false,
      });
    }
    e.P = e.cities.reduce((a, c) => a + c.P, 0);
    out.push(e);
  }
  out.forEach((e) => {
    e.countryBase = e.base;
    refreshForeignTrade(e, goods);
  });
  return out;
}
function refreshForeignTrade(e, goods) {
  const v = e.P / 1e6;
  e.tradeOut = {};
  e.tradeUse = {};
  (goods || Object.keys(GOODS)).forEach((g) => {
    e.tradeOut[g] = g === e.tradeGood ? v * 0.35 : v * 0.035;
    e.tradeUse[g] = v * 0.055 * (g === "food" ? 2 : 1);
  });
}
export function advanceForeignStates() {
  const goods = Object.keys(GOODS);
  S.ext.forEach((e) => {
    if (e.player) return;
    let total = 0;
    e.cities.forEach((c) => {
      c.P = Math.min(c.P * (1 + monthRate(c.growth)), Math.max(c.P0 * 3, c.P0 + 100000));
      total += c.P;
    });
    if (
      S.monthIndex === 11 &&
      S.year % 30 === 0 &&
      e.cityNames &&
      e.cityNames.length &&
      total > 1.2e6
    ) {
      const rr = mulberry32((S.seed ^ Math.imul(S.year + e.k * 131, 0x45d9f3b)) >>> 0),
        p = foreignCityPoint(e, e.cities, rr),
        base = Math.max(12000, Math.min(80000, total * 0.012)),
        name = e.cityNames.shift();
      e.cities.push({
        name,
        x: p.x,
        y: p.y,
        P: base,
        P0: base,
        growth: e.growth * 1.12,
        capital: false,
      });
      total += base;
    }
    e.P = total;
    e.tradeP = e.P;
    e.aiP = e.P;
    refreshForeignTrade(e, goods);
  });
}
