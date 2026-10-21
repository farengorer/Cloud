import {
  ABAND,
  BIZ,
  BUILT,
  CAP,
  CELLHA,
  CELLKM,
  DENSE,
  EMPTY,
  G,
  HIGH,
  HIST,
  IND,
  IZHS,
  MID,
  P,
  SECT,
  SKY,
  WATER,
} from "./config";
import { districtAt, districtRecordAt } from "./districts";
import { logEv, targets } from "./model";
import { skyUp } from "./skyscrapers";
import { S, rng } from "./state";
import { areaShares, elevVal, forestVal, riverDist, riverWaterAt } from "./terrain";
import { clamp, weightedOrder } from "./util";
import { makeVillages, ruralTarget } from "./villages";
import { mtVal, seaD } from "./worldgen";

const NB = new Uint8Array(G * G),
  NBD = new Uint8Array(G * G),
  NEAR = new Uint8Array(G * G);
function computeNb(c) {
  const g = c.grid;
  NB.fill(0);
  NBD.fill(0);
  NEAR.fill(0);
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const t = g[y * G + x];
      if (!BUILT[t]) continue;
      const dn = DENSE[t];
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= G) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= G) continue;
          const j = yy * G + xx;
          NEAR[j] = 1;
          if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && (dx || dy)) {
            NB[j]++;
            if (dn) NBD[j]++;
          }
        }
      }
    }
}
function addNbAt(x, y, dense) {
  for (let dy = -2; dy <= 2; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= G) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= G) continue;
      const j = yy * G + xx;
      NEAR[j] = 1;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) {
        NB[j]++;
        if (dense) NBD[j]++;
      }
    }
  }
}
export function bfs(src, out, cap) {
  out.fill(255);
  const q = [];
  for (let k = 0; k < G * G; k++)
    if (src[k]) {
      out[k] = 0;
      q.push(k);
    }
  for (let h = 0; h < q.length; h++) {
    const k = q[h],
      x = k % G,
      y = (k / G) | 0,
      d = out[k];
    if (d >= cap) continue;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
        const j = yy * G + xx;
        if (out[j] > d + 1) {
          out[j] = d + 1;
          q.push(j);
        }
      }
  }
}
export function rasterLine(mask, pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[i + 1],
      n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let s = 0; s <= n; s++) {
      const px = Math.floor(x0 + ((x1 - x0) * s) / n),
        py = Math.floor(y0 + ((y1 - y0) * s) / n);
      if (px >= 0 && px < G && py >= 0 && py < G) mask[py * G + px] = 1;
    }
  }
}
export function addGridRoad(c, th) {
  let x = c.cx + 0.5,
    y = c.cy + 0.5,
    ang = th;
  const pts = [[x, y]];
  while (x > -2 && x < G + 2 && y > -2 && y < G + 2) {
    const gx = Math.floor(x),
      gy = Math.floor(y);
    if (gx >= 0 && gx < G && gy >= 0 && gy < G && c.grid[gy * G + gx] === WATER) break;
    ang += (rng() - 0.5) * 0.25;
    ang = ang * 0.85 + th * 0.15;
    x += Math.cos(ang) * 3;
    y += Math.sin(ang) * 3;
    pts.push([x, y]);
  }
  c.roads.push(pts);
  rasterLine(c.roadMask, pts);
  bfs(c.roadMask, c.roadD, 30);
}
export function addGridRail(c, th) {
  const o = (rng() - 0.5) * 10,
    nx = -Math.sin(th),
    ny = Math.cos(th),
    x0 = c.cx + 0.5 + nx * o,
    y0 = c.cy + 0.5 + ny * o;
  c.rails.push([
    [x0 - Math.cos(th) * 4, y0 - Math.sin(th) * 4],
    [x0 + Math.cos(th) * 90, y0 + Math.sin(th) * 90],
  ]);
}
export function computeForeign(c) {
  const others = S.cities.filter(
    (o) => o !== c && Math.abs(o.x - c.x) < G * CELLKM && Math.abs(o.y - c.y) < G * CELLKM,
  );
  c.foreign = new Uint8Array(G * G);
  if (!others.length) return;
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const wx = c.x + (gx - c.cx) * CELLKM,
        wy = c.y + (gy - c.cy) * CELLKM,
        d0 = (wx - c.x) * (wx - c.x) + (wy - c.y) * (wy - c.y);
      for (const o of others) {
        if ((wx - o.x) * (wx - o.x) + (wy - o.y) * (wy - o.y) < d0) {
          c.foreign[gy * G + gx] = 1;
          break;
        }
      }
    }
}
export function makeCity(o) {
  const c: Record<string, any> = {
    i: S.cities.length,
    name: o.name,
    x: o.x,
    y: o.y,
    P: o.pop,
    J: 0,
    H: 0,
    founded: S.year,
    grace: o.grace ? S.year + 15 : 0,
    grid: new Uint8Array(G * G),
    forest: new Uint8Array(G * G),
    elev: new Float32Array(G * G),
    slope: new Float32Array(G * G),
    roadD: new Uint8Array(G * G),
    roadMask: new Uint8Array(G * G),
    stD: new Uint8Array(G * G).fill(255),
    roads: [],
    rails: [],
    metro: [],
    districts: [],
    metroCov: 0,
    hosp: 0,
    uni: 0,
    mus: 0,
    park: 0,
    tech: 0,
    air: 0,
    airLevel: 0,
    airportName: "",
    airportCode: "",
    seaPortLevel: 0,
    riverPortLevel: 0,
    port: 0,
    rw: null,
    paxLoad: 0,
    paxDemand: 0,
    ent: [],
    firms: {},
    jobs: {},
    carryH: 0,
    carryI: 0,
    carryA: 0,
    hist: [o.pop],
    lastBuild: 0,
    flags: {},
    R: 0,
    vsites: [],
    cx: G >> 1,
    cy: G >> 1,
    o: 0.95,
    price: 1,
    A: 1,
    Arel: 1,
    area: 0,
    aband: 0,
    builtCells: 0,
    health: 1,
    edu: 0,
    cult: 0,
    spec: "",
    MAr: 1,
  };
  const rd = riverDist(o.x, o.y, 1),
    sh = areaShares(o.x, o.y);
  c.river = rd < 3;
  c.forestSh = sh.forest;
  c.soilSh = sh.soil;
  c.nature = (rd < 4 ? 0.5 : 0) + sh.forest;
  c.pw = {};
  c.coast = !!(S.T.sea && seaD(o.x, o.y) < 4);
  if (c.coast) c.nature += 0.4;
  if (S.T.ridge) c.nature += 0.6 * mtVal(o.x, o.y);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const k = gy * G + gx,
        wx = o.x + (gx - c.cx) * CELLKM,
        wy = o.y + (gy - c.cy) * CELLKM;
      c.elev[k] = elevVal(wx, wy) * 0.7 + 0.3 * S.T.nD(wx * 1.5, wy * 1.5);
      if ((S.T.sea && seaD(wx, wy) < 0) || riverWaterAt(wx, wy)) c.grid[k] = WATER;
      else if (forestVal(wx, wy) > 0.6 && Math.hypot(gx - c.cx, gy - c.cy) > 6) c.forest[k] = 1;
    }
  c.grid[c.cy * G + c.cx] = EMPTY;
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const xl = Math.max(0, x - 1),
        xr = Math.min(G - 1, x + 1),
        yu = Math.max(0, y - 1),
        yd = Math.min(G - 1, y + 1);
      c.slope[y * G + x] = Math.min(
        1,
        Math.hypot(
          c.elev[y * G + xr] - c.elev[y * G + xl],
          c.elev[yd * G + x] - c.elev[yu * G + x],
        ) * 30,
      );
    }
  const lr = rng() * Math.PI * 2;
  addGridRoad(c, lr);
  addGridRoad(c, lr + Math.PI * (0.7 + rng() * 0.6));
  S.cities.push(c);
  c.districtId = districtAt(c.x, c.y);
  const territory = districtRecordAt(c.x, c.y);
  if (territory) {
    const reg = S.regions[territory.regionId];
    if (reg && reg.center == null) reg.center = c.i;
  }
  makeVillages(c);
  S.cities.forEach((o) => {
    if (o === c || Math.hypot(o.x - c.x, o.y - c.y) < G * CELLKM * 1.5) computeForeign(o);
  });
  c.R = o.rural != null ? o.rural : Math.min(ruralTarget(c), 3000);
  grow0(c, o.cap || o.pop / 0.95);
  SECT.forEach((s) => {
    c.firms[s.k] = 0;
    c.jobs[s.k] = 0;
  });
  const tg = targets(c);
  SECT.forEach((s) => {
    c.firms[s.k] = (tg[s.k] / s.size) * (o.init || 1);
    c.jobs[s.k] = c.firms[s.k] * s.size;
  });
  c.J = SECT.reduce((a, s) => a + c.jobs[s.k], 0);
  if (o.pop > 15000) addIndustry(c, Math.round(6 + Math.sqrt((c.jobs as any).ind / 300)));
  recomputeH(c);
  {
    const cf0 = clarkFit(c);
    c.clark = cf0 ? [Object.assign(cf0, { first: 1 })] : [];
  }
  return c;
}
function grow0(c, target) {
  const t2 = clamp((Math.log10(target) - 3.6) / 1.3, 0.2, 0.62);
  const ci = c.cy * G + c.cx;
  c.grid[ci] = HIST;
  c.forest[ci] = 0;
  let H = CAP[HIST],
    guard = 0;
  computeNb(c);
  while (H < target && guard++ < 3000) {
    const f = H / target,
      phase = f < 0.1 ? HIST : f < 0.1 + t2 ? MID : IZHS;
    const cand = [],
      w = [];
    for (let k = 0; k < G * G; k++) {
      if (c.grid[k] !== EMPTY || c.forest[k] || (c.foreign && c.foreign[k])) continue;
      const x = k % G,
        y = (k / G) | 0,
        d = Math.hypot(x - c.cx, y - c.cy),
        sl = 1 - 0.7 * c.slope[k],
        rd = c.roadD[k] <= 1 ? 1 : 0;
      let ww = 0;
      if (phase !== IZHS) {
        if (NB[k] >= 1) ww = Math.pow(NB[k], 3) * (1 + rd) * sl;
      } else if (NB[k] >= 1 || NEAR[k] || (rd && d < 50))
        ww = Math.pow(0.3 + NB[k], 1.5) * (1 + 3 * rd) * sl * Math.exp(-d / 34);
      if (ww > 0) {
        cand.push(k);
        w.push(ww);
      }
    }
    if (!cand.length) break;
    const k = clamp(Math.round((target - H) / CAP[phase] / 4), 1, 90);
    for (const pos of weightedOrder(w, rng, k)) {
      let t = phase;
      if (phase === MID && f > 0.1 + t2 * 0.75 && rng() < 0.3) t = HIGH;
      const cell = cand[pos];
      c.grid[cell] = t;
      addNbAt(cell % G, (cell / G) | 0, DENSE[t]);
      H += CAP[t];
      if (H >= target) break;
    }
  }
}
export function addIndustry(c, size) {
  computeNb(c);
  const cand = [],
    w = [];
  for (let k = 0; k < G * G; k++) {
    if (c.grid[k] !== EMPTY || c.forest[k] || (c.foreign && c.foreign[k])) continue;
    if (NB[k] < 1 || c.roadD[k] > 3) continue;
    const d = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy);
    cand.push(k);
    w.push(0.2 + d);
  }
  if (!cand.length) return 0;
  const seed = cand[weightedOrder(w, rng, 1)[0]];
  const fr = [seed];
  c.grid[seed] = IND;
  let n = 1;
  while (n < size && fr.length) {
    const k = fr[(rng() * fr.length) | 0],
      x = k % G,
      y = (k / G) | 0;
    const opts = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
        const j = yy * G + xx;
        if ((c.grid[j] === EMPTY || c.grid[j] === ABAND) && !c.forest[j]) opts.push(j);
      }
    if (!opts.length) {
      fr.splice(fr.indexOf(k), 1);
      continue;
    }
    const j = opts[(rng() * opts.length) | 0];
    c.grid[j] = IND;
    fr.push(j);
    n++;
  }
  return n;
}
function builtRadius(c) {
  let r = 0;
  for (let k = 0; k < G * G; k++)
    if (BUILT[c.grid[k]]) {
      const d = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy);
      if (d > r) r = d;
    }
  return r;
}
export function placeRunway(c) {
  const r = Math.min(builtRadius(c) + 10, G / 2 - 8),
    a = rng() * Math.PI * 2,
    th = a + Math.PI / 2 + (rng() - 0.5) * 0.6;
  c.rw = { x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r, th };
}
/* metro: straight lines through the centre, stations every 6 cells (900 m) */
function lineDensity(c, th, r0, r1) {
  let s = 0;
  for (let r = r0; r <= r1; r++) {
    const x = Math.round(c.cx + Math.cos(th) * r),
      y = Math.round(c.cy + Math.sin(th) * r);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
        s += CAP[c.grid[yy * G + xx]];
      }
  }
  return s;
}
function angleTaken(c, th) {
  return c.metro.some((l) => {
    let d = Math.abs((((th - l.th) % Math.PI) + Math.PI) % Math.PI);
    d = Math.min(d, Math.PI - d);
    return d < 0.45;
  });
}
export function newLine(c) {
  let best = null;
  for (let a = 0; a < 24; a++) {
    const th = (a * Math.PI) / 24;
    if (angleTaken(c, th)) continue;
    const sc = Math.max(lineDensity(c, th, 0, 8), lineDensity(c, th + Math.PI, 0, 8));
    if (!best || sc > best.sc) best = { th, sc };
  }
  if (!best) return false;
  let th = best.th;
  if (lineDensity(c, th + Math.PI, 0, 8) > lineDensity(c, th, 0, 8)) th += Math.PI;
  c.metro.push({ th, st: [0, 6] });
  metroUpdate(c);
  return true;
}
export function newLineBlocked(c) {
  for (let a = 0; a < 24; a++) if (!angleTaken(c, (a * Math.PI) / 24)) return false;
  return true;
}
export function extCandidates(c) {
  const out = [];
  c.metro.forEach((l, li) => {
    const lo = Math.min(...l.st),
      hi = Math.max(...l.st);
    [
      [hi + 6, hi + 3, hi + 9],
      [lo - 6, lo - 9, lo - 3],
    ].forEach(([r, a, b]) => {
      if (Math.abs(r) > G / 2 - 5) return;
      const sc = lineDensity(c, l.th, a, b);
      if (sc > 0) out.push({ li, r, sc });
    });
  });
  out.sort((a, b) => b.sc - a.sc);
  return out;
}
export function extendLine(c) {
  const cand = extCandidates(c);
  if (!cand.length) return false;
  const b = cand[0];
  c.metro[b.li].st.push(b.r);
  metroUpdate(c);
  return true;
}
function stationXY(c, l, r) {
  return [c.cx + 0.5 + Math.cos(l.th) * r, c.cy + 0.5 + Math.sin(l.th) * r];
}
export function metroUpdate(c) {
  const m = new Uint8Array(G * G);
  c.metro.forEach((l) =>
    l.st.forEach((p) => {
      const xi = Math.floor(p[0]),
        yi = Math.floor(p[1]);
      if (xi >= 0 && yi >= 0 && xi < G && yi < G) m[yi * G + xi] = 1;
    }),
  );
  bfs(m, c.stD, 30);
  metroCover(c);
}
function metroCover(c) {
  if (!stations(c)) {
    c.metroCov = 0;
    return;
  }
  let a = 0,
    b = 0;
  for (let k = 0; k < G * G; k++) {
    const h = CAP[c.grid[k]];
    if (!h) continue;
    a += h;
    if (c.stD[k] <= 6) b += h;
  }
  c.metroCov = a ? b / a : 0;
}
export function stations(c) {
  return c.metro.reduce((s, l) => s + l.st.length, 0);
}
/* Clark's model D(r)=D0*exp(-b*r): gross density in 1 km rings around the centre, log-linear least squares */
export function clarkFit(c) {
  const occ = Math.min(1.06, c.P / Math.max(1, c.H)),
    R = Math.ceil((G / 2) * CELLKM * 1.42) + 1,
    pop = new Float64Array(R),
    cells = new Float64Array(R);
  for (let k = 0; k < G * G; k++) {
    const r = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy) * CELLKM,
      b = Math.floor(r);
    if (b >= R) continue;
    cells[b]++;
    pop[b] += CAP[c.grid[k]] * occ;
  }
  let tot = 0;
  for (let b = 0; b < R; b++) tot += pop[b];
  if (tot < 500) return null;
  let cum = 0,
    rmax = 0;
  for (let b = 0; b < R; b++) {
    cum += pop[b];
    if (cum >= 0.98 * tot) {
      rmax = b;
      break;
    }
  }
  let sw = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  const pts = [];
  for (let b = 0; b <= rmax; b++) {
    if (pop[b] <= 0 || !cells[b]) continue;
    const d = pop[b] / (cells[b] * CELLKM * CELLKM),
      x = b + 0.5,
      y = Math.log(d),
      w = cells[b];
    pts.push([x, y, w]);
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  if (pts.length < 3) return null;
  const bb = (sw * sxy - sx * sy) / (sw * sxx - sx * sx),
    a = (sy - bb * sx) / sw,
    my = sy / sw;
  let ssr = 0,
    sst = 0;
  pts.forEach(([x, y, w]) => {
    const f = a + bb * x;
    ssr += w * (y - f) * (y - f);
    sst += w * (y - my) * (y - my);
  });
  return { y: S.year, D0: Math.exp(a), b: -bb, r2: sst > 0 ? 1 - ssr / sst : 1, R: rmax + 1 };
}
export function recomputeH(c) {
  let H = 0,
    a = 0,
    ab = 0;
  const hd = new Uint32Array(G);
  for (let k = 0; k < G * G; k++) {
    const t = c.grid[k];
    H += CAP[t];
    if (BUILT[t]) {
      hd[Math.max(Math.abs((k % G) - c.cx), Math.abs(((k / G) | 0) - c.cy))]++;
      if (t !== ABAND) a++;
      else ab++;
    }
  }
  {
    let cum = 0,
      tot = a + ab,
      br = 0;
    for (let d = 0; d < G; d++) {
      cum += hd[d];
      if (cum >= 0.95 * tot) {
        br = d;
        break;
      }
    }
    c.brad = br;
  }
  c.H = Math.max(H, 1);
  c.area = (a * CELLHA) / 100;
  c.aband = ab;
  c.builtCells = a;
  let bz = 0;
  for (let k = 0; k < G * G; k++) if (c.grid[k] === BIZ) bz++;
  c.biz = bz;
}
export function bizUpdate(c) {
  const m = new Uint8Array(G * G);
  let any = 0;
  for (let k = 0; k < G * G; k++)
    if (c.grid[k] === BIZ) {
      m[k] = 1;
      any = 1;
    }
  if (!any) return;
  c.bizD = c.bizD || new Uint8Array(G * G);
  bfs(m, c.bizD, 30);
}
function place(c, type, amount) {
  const key = type === HIGH ? "carryH" : "carryI";
  let budget = c[key] + amount;
  if (budget <= 0) return 0;
  const cand = [],
    w = [],
    gain = [];
  const hasM = stations(c) > 0 || c.extSt > 0;
  for (let k = 0; k < G * G; k++) {
    const t = c.grid[k];
    if (
      t === WATER ||
      t === HIST ||
      t === IND ||
      t === MID ||
      t === HIGH ||
      t === BIZ ||
      t === SKY ||
      (c.foreign && c.foreign[k] && t === EMPTY)
    )
      continue;
    const fr = c.forest[k];
    if (fr && P.forest && t === EMPTY) continue;
    const x = k % G,
      y = (k / G) | 0,
      d = Math.hypot(x - c.cx, y - c.cy),
      sl = 1 - 0.65 * c.slope[k],
      rd = c.roadD[k];
    let ww = 0,
      g = 0;
    if (type === HIGH) {
      const sb =
        (hasM ? 1 + 4 * Math.exp(-c.stD[k] / 3) : 1) *
        (c.biz && c.bizD ? 1 + 3 * Math.exp(-c.bizD[k] / 4) : 1);
      if (t === EMPTY && NB[k] >= 1) {
        ww =
          (1 + NBD[k]) * (1 + NBD[k]) * Math.exp(-d / 34) * (1 + 0.6 * Number(rd <= 2)) * sl * sb;
        g = CAP[HIGH];
      } else if ((t === IZHS || t === ABAND) && NBD[k] >= 2) {
        ww = 0.5 * (1 + NBD[k]) * (1 + NBD[k]) * Math.exp(-d / 34) * sb;
        g = CAP[HIGH] - CAP[t];
      } else if (hasM && t === EMPTY && c.stD[k] <= 2) {
        ww = 3 * sb;
        g = CAP[HIGH];
      }
    } else {
      if (t === EMPTY && (NEAR[k] || (rd <= 1 && d < 56))) {
        ww = Math.pow(0.4 + NB[k], 1.3) * (1 + 2.5 * Number(rd <= 1)) * sl * Math.exp(-d / 48);
        g = CAP[IZHS];
      } else if (t === ABAND) {
        ww = 4 * (0.4 + NB[k]);
        g = CAP[IZHS];
      }
    }
    if (ww > 0) {
      if (fr) ww *= 0.4;
      cand.push(k);
      w.push(ww);
      gain.push(g);
    }
  }
  if (!cand.length) {
    if (!c.flags.sat) {
      c.flags.sat = 1;
      logEv("Город " + c.name + " исчерпал свободную территорию на плане");
    }
    c[key] = 0;
    return 0;
  }
  let got = 0;
  for (const pos of weightedOrder(w, rng)) {
    const g = gain[pos];
    if (g > budget) break;
    const k = cand[pos];
    c.grid[k] = type;
    c.forest[k] = 0;
    budget -= g;
    got += g;
  }
  c[key] = Math.min(budget, 3 * CAP[type]);
  return got;
}
function abandon(c, amount) {
  let budget = c.carryA + amount;
  const cand = [],
    w = [];
  for (let k = 0; k < G * G; k++) {
    const t = c.grid[k];
    if (t !== IZHS && t !== MID) continue;
    const d = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy) / G;
    cand.push(k);
    w.push((t === IZHS ? 1.5 : 0.5) * (d + 0.08) * (d + 0.08));
  }
  let rem = 0;
  if (cand.length)
    for (const pos of weightedOrder(w, rng)) {
      const k = cand[pos],
        g = CAP[c.grid[k]];
      if (g > budget) break;
      c.grid[k] = ABAND;
      budget -= g;
      rem += g;
    }
  c.carryA = Math.min(budget, 400);
  return rem;
}
export function micro(c, period = 1) {
  computeNb(c);
  let built = 0;
  if (c.P > 0.96 * c.H) {
    const need = c.P / 0.94 - c.H,
      cap = P.build * (0.035 * c.H + Math.min(1200, 0.08 * c.H + 100)) * period,
      X = Math.min(need, cap);
    const hs = (P.hr / 100) * clamp((Math.log10(c.P) - 3.8) / 1.6, 0.1, 1);
    const sk = c.P >= 450000 ? 0.35 * clamp((c.P - 450000) / 1e6 + 0.3, 0, 1) : 0;
    built += skyUp(c, X * hs * sk);
    built += place(c, HIGH, X * hs * (1 - sk));
    built += place(c, IZHS, X * (1 - hs));
  } else if (c.P < 0.88 * c.H && S.year >= c.grace) abandon(c, (c.H - c.P / 0.88) * 0.15 * period);
  recomputeH(c);
  if (stations(c)) metroCover(c);
  c.lastBuild = built;
}
