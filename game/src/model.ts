import { MONTH, closeBudgetYear, monthRate, recordBudgetMonth, stPen } from "./actions";
import { aggCompute } from "./agglomerations";
import { clarkFit, makeCity, micro } from "./city";
import { buildTerrainImg } from "./colors";
import { NAMES, P, RH, RW, SECT, SPEC, SPEC_INS, YMAX } from "./config";
import {
  DCOL,
  claimDistrict,
  districtAt,
  districtRecordAt,
  initialDistrictIds,
  makeAdminDistrictMap,
  startingTownSite,
} from "./districts";
import { roadClass } from "./draw";
import { basePrices, econStep, entJobs, regionQ, zeroGoods } from "./economy";
import { PLANT, energy } from "./energy";
import { CAPS } from "./multiplayer";
import { parkNature, parkTour } from "./saveload";
import {
  S,
  TT,
  acc,
  lastGameDate,
  lastPairs,
  rng,
  setAcc,
  setLastGameDate,
  setLastPairs,
  setRng,
  setS,
  setTT,
} from "./state";
import {
  advanceForeignStates,
  cultureById,
  forestVal,
  hasCargoPort,
  makeExternal,
  makeTerrain,
  placeDeposits,
  riverDist,
} from "./terrain";
import { $, clamp, fmtPop, mulberry32 } from "./util";
import { makeRuralSites, ruralTarget } from "./villages";
import { isIceAt, makePlanet, makeWorld2, seaD, worldText } from "./worldgen";

export const wrapX = (x) => ((x % RW) + RW) % RW;
export const nearX = (x, ref) => x + Math.round((ref - x) / RW) * RW;
export const geoXY = (x, y, a, b) =>
  Math.hypot(
    Math.min(Math.abs(x - a), RW - Math.abs(x - a)) *
      Math.max(0.08, Math.cos((y / RH - 0.5) * Math.PI)),
    y - b,
  );
export const dist = (a, b) =>
  Math.hypot(
    S.planet ? Math.min(Math.abs(a.x - b.x), RW - Math.abs(a.x - b.x)) : a.x - b.x,
    a.y - b.y,
  );
function nodes() {
  return S.cities.concat(S.ext);
}
export function byKey(k) {
  return typeof k === "string" ? S.ext[+k.slice(1)] : S.cities[k];
}
function keyIdx(k) {
  return typeof k === "string" ? S.cities.length + +k.slice(1) : k;
}
export function linkBetween(a, b, mode) {
  return S.roads.find(
    (r) => r.mode === mode && ((r.a === a && r.b === b) || (r.a === b && r.b === a)),
  );
}
export function linkKm(a, b) {
  const A = byKey(a),
    B = byKey(b);
  if (B.ext) return S.planet ? geoXY(A.x, A.y, B.gx, B.gy) : Math.hypot(A.x - B.gx, A.y - B.gy);
  if (A.ext) return S.planet ? geoXY(B.x, B.y, A.gx, A.gy) : Math.hypot(B.x - A.gx, B.y - A.gy);
  return dist(A, B);
}
export const MAX_BRIDGE = 18;
export function bridgeSpan(ax, ay, bx, by) {
  if (!S.planet || !S.T.sea) return 0;
  bx = nearX(bx, ax);
  const dx = bx - ax,
    dy = by - ay,
    n = Math.max(2, Math.ceil(Math.hypot(dx, dy) * 2)),
    step = Math.hypot(dx, dy) / n;
  let run = 0,
    best = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (seaD(wrapX(ax + dx * t), ay + dy * t) < 0) {
      run += step;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}
export function roadWaterError(a, b) {
  const A = byKey(a),
    B = byKey(b);
  const x1 = A.ext ? A.gx : A.x,
    y1 = A.ext ? A.gy : A.y,
    x2 = B.ext ? B.gx : B.x,
    y2 = B.ext ? B.gy : B.y;
  const span = bridgeSpan(x1, y1, x2, y2);
  return span > MAX_BRIDGE
    ? "Мост через воду не может быть длиннее " +
        MAX_BRIDGE +
        " км (здесь " +
        Math.round(span) +
        " км)."
    : "";
}
export function linkSpeed(r) {
  if (r.mode === "rail") return r.fast ? 150 : 90;
  const cls = roadClass(r),
    factor = { local: 0.72, regional: 1, national: 1.28, international: 1.42 }[cls] || 1;
  return P.speed * factor * (r.fast ? 1.6 : 1);
}
export const AIR_MAX_FREQ = 360,
  AIR_SEATS = 150,
  AIR_DAYS_MONTH = 365 / 12;
export function airRouteCost(a, b) {
  return 0.08 + dist(S.cities[a], S.cities[b]) * 0.0001;
}
export function flightsPerMonth(r) {
  const raw = r.fpm != null ? r.fpm : (Number(r.freq) || 1) * AIR_DAYS_MONTH;
  return clamp(Math.round(raw), 1, AIR_MAX_FREQ);
}
export function airFreqCost(r) {
  return (0.025 + dist(S.cities[r.a], S.cities[r.b]) * 0.000025) / AIR_DAYS_MONTH;
}
export function airRouteStats(r) {
  const a = S.cities[r.a],
    b = S.cities[r.b];
  if (!a || !b) return null;
  const fpm = flightsPerMonth(r),
    daily = fpm / AIR_DAYS_MONTH,
    km = dist(a, b),
    capacity = Math.min(fpm * 12 * AIR_SEATS, (a.term || 1) * 1e6, (b.term || 1) * 1e6),
    service = 0.8 + 0.2 * Math.sqrt(clamp(fpm / 30, 0, 1)),
    demand =
      0.16 *
      Math.sqrt(Math.max(0, a.P + a.R) * Math.max(0, b.P + b.R)) *
      Math.exp(-km / 3200) *
      service,
    pax = Math.min(demand, capacity);
  return {
    fpm,
    flightsYear: fpm * 12,
    km,
    capacity,
    demand,
    pax,
    load: pax / Math.max(1, capacity),
    time:
      75 +
      (60 * km) / 700 +
      720 / Math.max(0.05, daily) +
      120 * Math.max(0, demand / Math.max(1, capacity) - 1),
  };
}
function travelMatrix() {
  const cs = S.cities,
    n = cs.length,
    N = n + S.ext.length,
    nd = nodes();
  setTT([]);
  for (let i = 0; i < N; i++) {
    TT.push(new Array(N));
    for (let j = 0; j < N; j++) {
      if (i === j) {
        TT[i][j] = 0;
        continue;
      }
      const a = nd[i],
        b = nd[j];
      if (a.ext && b.ext) {
        TT[i][j] = (75 * dist(a, b)) / 80;
        continue;
      }
      if (a.ext || b.ext) {
        const e = a.ext ? a : b,
          c = a.ext ? b : a;
        TT[i][j] = (75 * (S.planet ? geoXY(c.x, c.y, e.gx, e.gy) : dist(c, e))) / 40;
        continue;
      }
      TT[i][j] =
        S.planet && bridgeSpan(a.x, a.y, b.x, b.y) > MAX_BRIDGE ? 1e6 : (75 * dist(a, b)) / 15;
    }
  }
  S.roads.forEach((r) => {
    const ia = keyIdx(r.a),
      ib = keyIdx(r.b),
      A = byKey(r.a),
      B = byKey(r.b),
      v = linkSpeed(r);
    let t;
    if (B.ext || A.ext) {
      const e = B.ext ? B : A,
        c = B.ext ? A : B;
      t =
        (75 * Math.hypot(c.x - e.gx, c.y - e.gy)) / v +
        (75 * Math.hypot(e.x - e.gx, e.y - e.gy)) / (r.mode === "rail" ? 100 : 90);
    } else t = (75 * dist(A, B)) / v;
    if (r.mode === "road" && !A.ext && !B.ext && (A.core === B.i || B.core === A.i)) {
      const K = A.core === B.i ? B : A;
      t *= 1 + 0.6 * Math.min(1, (K.PA || K.P) / 1e6);
    }
    if (r.mode === "rail") t += stPen(A) + stPen(B);
    if (t < TT[ia][ib]) {
      TT[ia][ib] = t;
      TT[ib][ia] = t;
    }
  });
  cs.forEach((o) => {
    if (o.core >= 0 && o.extSt > 0 && o.metroCov > 0.03) {
      const c = cs[o.core],
        t = (60 * dist(o, c) * 1.1) / 45 + 3;
      if (t < TT[o.i][c.i]) {
        TT[o.i][c.i] = t;
        TT[c.i][o.i] = t;
      }
    }
  });
  (S.airRoutes || []).forEach((r) => {
    const a = cs[r.a],
      b = cs[r.b],
      st = airRouteStats(r);
    if (!a || !b || !a.air || !b.air || !st) return;
    Object.assign(r, st);
    if (st.time < TT[a.i][b.i]) {
      TT[a.i][b.i] = st.time;
      TT[b.i][a.i] = st.time;
    }
  });
  for (let k = 0; k < N; k++)
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const v = TT[i][k] + TT[k][j];
        if (v < TT[i][j]) TT[i][j] = v;
      }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      if (i === j)
        TT[i][j] = i < n ? (8 + 4 * Math.sqrt(cs[i].P / 1e5)) * (1 - 0.35 * cs[i].metroCov) : 30;
      else TT[i][j] += 10;
    }
  // air: flights from airports to neighbouring regions, used by any city via its fastest way to the airport
  cs.forEach((a) => {
    if (!a.air) return;
    let dem = 0;
    for (let j = 0; j < n; j++) dem += cs[j].P * Math.exp(-TT[j][a.i] / 60);
    const routePax = (S.airRoutes || []).reduce(
      (sum, r) => (r.a === a.i || r.b === a.i ? sum + (airRouteStats(r)?.pax || 0) : sum),
      0,
    );
    a.paxDemand = 1.5 * dem + routePax;
    a.paxLoad = a.paxDemand / (a.term * 1e6);
    S.ext.forEach((e) => {
      if (e.big && !a.runway) return;
      const ft = 75 + (60 * dist(a, e)) / 550 + 60 * Math.max(0, a.paxLoad - 1),
        ie = n + e.k;
      for (let i = 0; i < n; i++) {
        const v = TT[i][a.i] + ft;
        if (v < TT[i][ie]) {
          TT[i][ie] = v;
          TT[ie][i] = v;
        }
      }
    });
  });
}
export function targets(c) {
  const P_ = c.P,
    aggF = Math.pow(Math.max(P_, 2000) / 1e5, 0.08 * P.agg),
    MAr = c.MAr || 1,
    ej = entJobs(c);
  const tourBase =
    350 * c.mus + 400 * Math.min(c.nature, 1.2) + 0.004 * P_ + parkTour(c) + (c.coast ? 600 : 0);
  return {
    ind:
      (0.035 * P_ * Math.pow(clamp(MAr, 0.2, 4), 0.3) * aggF + 2500 * c.park) *
        (1 + 0.12 * Math.min(c.lc || 0, 3) + (hasCargoPort(c) ? 0.1 : 0)) +
      ((ej as any).ind || 0) +
      (c.sez ? 2000 : 0) +
      Object.keys(PLANT).reduce((a, k) => a + PLANT[k].jobs * ((c.pw && c.pw[k]) || 0), 0),
    log:
      0.008 * P_ + 1500 * (c.lc || 0) + 1200 * (hasCargoPort(c) ? 1 : 0) + 300 * (c.station || 0),
    mine: (ej as any).mine || 0,
    agro: c.soilSh * 900 + 0.006 * P_ + ((ej as any).agro || 0),
    wood: c.forestSh * 500 + ((ej as any).wood || 0),
    it:
      (((c.uni ? 0.025 * P_ * (1 + 0.5 * Math.log(c.uni)) : 0.003 * P_) * aggF + 2500 * c.tech) *
        (c.runway ? 1.2 : 1) +
        ((ej as any).it || 0) +
        150 * (c.biz || 0)) *
      (c.sci ? 1.6 : 1),
    tour:
      tourBase * (c.runway ? 1.4 : c.air ? 1.15 : 1) +
      2500 * (c.gmus || 0) +
      ((ej as any).tour || 0),
    gov:
      (c.govc ? 0.035 : 0.008) * P_ +
      (c.govc ? 2500 : 0) +
      (c.hq ? 4000 : 0) +
      90 * (c.biz || 0) +
      0.012 * (c.dPop && !c.govc ? c.dPop : 0),
    serv: 0.28 * P_ + (c.air ? 150 * c.term : 0) + 360 * (c.biz || 0) + 300 * (c.station || 0),
  };
}
/* services: each facility serves a fixed number of people; own residents first, spare capacity goes to neighbours within reach */
function serviceCover(key, per, out, tau) {
  const cs = S.cities,
    pop = cs.map((c) => c.P + c.R),
    cap = cs.map((c) => (c[key] || 0) * per);
  const def = pop.map((v, i) => Math.max(0, v - cap[i])),
    got = pop.map((v, i) => Math.min(v, cap[i]));
  cs.map((c, i) => i)
    .filter((j) => cap[j] > pop[j])
    .sort((a, b) => cap[b] - pop[b] - (cap[a] - pop[a]))
    .forEach((j) => {
      const sur = cap[j] - pop[j];
      const w = cs.map((c, i) =>
          i === j || TT[i][j] > 90 ? 0 : def[i] * Math.exp(-TT[i][j] / tau),
        ),
        W = w.reduce((a, b) => a + b, 0);
      if (!W) return;
      const give = Math.min(sur, W);
      cs.forEach((c, i) => {
        if (!w[i]) return;
        const a = Math.min(def[i], (give * w[i]) / W);
        def[i] -= a;
        got[i] += a;
      });
    });
  cs.forEach((c, i) => {
    c[out] = pop[i] ? Math.min(1, got[i] / pop[i]) : 1;
    c[out + "Srv"] = got[i];
    c[out + "Pop"] = pop[i];
  });
}
function eduLevel() {
  const cs = S.cities;
  cs.forEach((c, i) => {
    let b = 0;
    cs.forEach((o, j) => {
      if (o.uni) b = Math.max(b, (o.uni / 5) * Math.exp(-TT[i][j] / 60));
    });
    c.edu = Math.min(1, b);
  });
}
function fixCenters() {
  if (S.planet) {
    S.regions.forEach((d) => {
      d.cities = [];
      d.manualCities = d.manualCities || [];
      d.districts = d.districts || [];
    });
    S.cities.forEach((c, i) => {
      if (c.districtId == null) c.districtId = districtAt(c.x, c.y);
      const territory = S.districtById && S.districtById.get(c.districtId);
      if (territory && S.regions[territory.regionId]) S.regions[territory.regionId].cities.push(i);
    });
    S.regions.forEach((d) => {
      if (d.center == null || !d.cities.includes(d.center))
        d.center = d.cities.length
          ? d.cities.slice().sort((a, b) => S.cities[b].P - S.cities[a].P)[0]
          : null;
    });
  } else
    S.regions.forEach((d) => {
      d.cities = d.cities.filter((i) => S.cities[i]);
      if (!d.cities.length) {
        d.center = null;
        return;
      }
      if (d.center == null || d.cities.indexOf(d.center) < 0)
        d.center = d.cities.slice().sort((a, b) => S.cities[b].P - S.cities[a].P)[0];
    });
  if (S.planet) {
    /* City membership follows the district's regional assignment. */
  }
  S.cities.forEach((c) => (c.dPop = 0));
  S.regions.forEach((d) => {
    if (d.center == null) return;
    S.cities[d.center].dPop = d.cities.reduce((a, i) => a + S.cities[i].P + S.cities[i].R, 0);
  });
}
export function evaluate() {
  fixCenters();
  aggCompute();
  travelMatrix();
  energy();
  const cs = S.cities,
    n = cs.length,
    nd = nodes(),
    N = nd.length;
  const JA = [],
    SA = [],
    MA = [];
  let jm = 0,
    sm = 0,
    mm = 0;
  for (let i = 0; i < n; i++) {
    let ja = 0,
      sa = 0,
      ma = 0,
      hc = 0,
      hp = 0,
      uc = 0,
      up = 0,
      cu = 0;
    for (let j = 0; j < N; j++) {
      const t = TT[i][j],
        o = nd[j];
      ma += o.P * Math.exp(-t / 60);
      if (o.ext) continue;
      const f = Math.exp(-t / 25);
      ja += o.J * f;
      sa += o.P * f;
      cu += o.mus * Math.exp(-t / 40) + (o.gmus || 0) * 6 * Math.exp(-t / 150);
    }
    JA.push(ja);
    SA.push(sa);
    MA.push(ma);
    jm += ja / n;
    sm += sa / n;
    mm += ma / n;
    cs[i].cult = cu;
  }
  serviceCover("hosp", 60000, "health", 30);
  eduLevel();
  let Am = 0;
  for (let i = 0; i < n; i++) {
    const c = cs[i];
    c.MAr = MA[i] / mm;
    c.o = c.P / c.H;
    c.price = clamp(Math.exp(6 * (c.o - 0.93)), 0.5, 20) * Math.pow(Math.max(c.P, 500) / 5e4, 0.07);
    const U =
      0.3 * Math.log(JA[i] / jm) +
      0.1 * Math.log(SA[i] / sm) +
      0.6 * c.health +
      0.3 * c.edu +
      0.15 * Math.log(1 + c.cult) +
      0.1 * Math.min(c.nature + parkNature(c), 1.5) -
      Math.log(c.price) -
      2 * S.en.def;
    c.A = Math.exp(U);
    Am += c.A / n;
  }
  cs.forEach((c) => (c.Arel = c.A / Am));
  S.Am = Am;
  S.Q = regionQ();
  S.ext.forEach((e) => {
    e.Arel = e.big ? 1 + (e.base - 1) * P.pull : e.base;
  });
  specialize();
}
function specialize() {
  const cs = S.cities;
  const tot = {};
  let all = 0;
  SECT.forEach((s) => (tot[s.k] = 0));
  cs.forEach((c) =>
    SECT.forEach((s) => {
      tot[s.k] += c.jobs[s.k];
      all += c.jobs[s.k];
    }),
  );
  cs.forEach((c) => {
    let best = null;
    const J = Math.max(c.J, 1);
    for (const k in SPEC) {
      const sh = c.jobs[k] / J,
        lq = sh / Math.max(tot[k] / all, 1e-6);
      if (sh > 0.1 && lq > 1.4 && (!best || sh * lq > best.v)) best = { k, v: sh * lq };
    }
    if (c.J < 0.3 * c.P && !c.govc) c.spec = "спальный пригород";
    else c.spec = best ? SPEC[best.k] : c.govc ? "административный" : "многофункциональный";
  });
}
export function stepMonth() {
  if (S.year >= YMAX) return;
  const cs = S.cities,
    n = cs.length;
  evaluate();
  const vac = cs.map((c) => Math.max(0, c.H * 0.97 - c.P));
  const F = [];
  for (let i = 0; i < n; i++) F.push(new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const w = new Array(n);
    for (let j = 0; j < n; j++) {
      const d = dist(cs[i], cs[j]),
        reach = S.planet ? 0.025 + 0.975 * Math.exp(-d / 150) : Math.exp(-d / 90),
        smallCityBonus = S.planet ? 1 + 0.15 * Math.exp(-cs[j].P / 400000) : 1;
      w[j] = cs[j].A * (cs[j].P + vac[j]) * reach * smallCityBonus;
      sum += w[j];
    }
    for (let j = 0; j < n; j++)
      if (j !== i) F[i][j] = ((1 - Math.pow(1 - 0.015, MONTH)) * cs[i].P * w[j]) / sum;
  }
  const net = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) net[i] += F[j][i] - F[i][j];
  let extTot = 0;
  S.ext.forEach((e) => {
    e.net = 0;
  });
  if (S.planet) {
    S.ext.forEach((e) => (e.net = 0));
    cs.forEach((c) => (c.extNet = 0));
    S.extNet = 0;
  } else {
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      let x = 0;
      S.ext.forEach((e) => {
        const t = TT[i][n + e.k];
        const d = Math.tanh(Math.log(e.Arel / c.Arel));
        const v = 0.02 * c.P * Math.pow(e.P / 1e6, 0.25) * Math.exp(-t / 400) * d * MONTH;
        x -= v;
        e.net += v;
      });
      c.extNet = x;
      net[i] += x;
      extTot += x;
    }
    S.extNet = extTot;
  }
  const inflow = P.inflow * 1000 * MONTH,
    we = cs.map(
      (c, j) =>
        c.A * Math.pow(c.P + vac[j], 0.9) * (c.runway ? 1.5 : 1) * (1 + 0.3 * (c.gmus || 0)),
    ),
    ws = we.reduce((a, b) => a + b, 0),
    natMonth = monthRate(P.nat / 1000),
    ruralMonth = monthRate(0.04),
    firmMonth = monthRate(0.15);
  setLastPairs([]);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const f = F[i][j] - F[j][i];
      if (Math.abs(f) > 1) lastPairs.push(f > 0 ? { a: i, b: j, v: f } : { a: j, b: i, v: -f });
    }
  lastPairs.sort((x, y) => y.v - x.v);
  let income = 0;
  for (let i = 0; i < n; i++) {
    const c = cs[i],
      prev = c.P;
    c.P = Math.max(50, c.P + net[i] + (inflow * we[i]) / ws + c.P * natMonth);
    {
      const dR = (ruralTarget(c) - c.R) * ruralMonth;
      c.R = Math.max(0, c.R * (1 + natMonth) + dR);
      if (dR < 0) c.P += -dR * 0.7;
      else c.P = Math.max(50, c.P - dR * 0.4);
      c.rDelta = dR;
    }
    const tg = targets(c);
    let J = 0;
    SECT.forEach((s) => {
      const goal = tg[s.k] / s.size;
      c.firms[s.k] = Math.max(
        0,
        c.firms[s.k] + (goal - c.firms[s.k]) * firmMonth * (0.8 + 0.4 * rng()),
      );
      c.jobs[s.k] = c.firms[s.k] * s.size;
      J += c.jobs[s.k];
    });
    c.J = J;
    micro(c, MONTH);
    if (c.P > 1.06 * c.H) {
      c.P = 1.06 * c.H;
      if (!c.flags.over) {
        c.flags.over = 1;
        logEv("Город " + c.name + " переполнен, лишние жители уезжают из области");
      }
    } else if (c.P < c.H) c.flags.over = 0;
    if (S.monthIndex === 11) {
      c.hist.push(c.P);
      if (!(c.clark && c.clark.length)) {
        const cf = clarkFit(c);
        if (cf) {
          cf.y = S.year + 1;
          (cf as any).first = 1;
          c.clark = [cf];
        }
      } else if ((S.year + 1) % 10 === 0) {
        const cf = clarkFit(c);
        if (cf) {
          cf.y = S.year + 1;
          (c.clark = c.clark || []).push(cf);
        }
      }
    }
    milestones(c, prev);
    income += (c.P + c.R) * 2e-5;
  }
  advanceForeignStates();
  S.ruralFlow = 0;
  if (S.planet && S.ruralPool > 0) {
    const cap = S.cities.find((c) => c.govc) || S.cities[0],
      flow = Math.min(S.ruralPool, Math.max(1, S.ruralPool * (1 - Math.pow(1 - 0.0025, MONTH))));
    S.ruralPool -= flow;
    S.ruralFlow = flow;
    if (cap) {
      const old = cap.P;
      cap.P += flow * 0.9;
      if (S.monthIndex === 11) cap.hist[cap.hist.length - 1] = cap.P;
      milestones(cap, old);
    }
    const small = cs.filter((c) => c !== cap && c.P < 500000),
      weights = small.map(
        (c) => c.A * (1 + 0.15 * Math.exp(-c.P / 400000)) * Math.sqrt(Math.max(1000, c.P)),
      ),
      weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum)
      small.forEach((c, i) => {
        const old = c.P;
        c.P += (flow * 0.1 * weights[i]) / weightSum;
        if (S.monthIndex === 11) c.hist[c.hist.length - 1] = c.P;
        milestones(c, old);
      });
    if (S.ruralSites && S.ruralPool >= 0) {
      let left = flow;
      S.ruralSites.forEach((v, i) => {
        const take =
          i === S.ruralSites.length - 1
            ? left
            : Math.min(v.p, (flow * v.p) / Math.max(flow, S.ruralPool + flow));
        v.p = Math.max(0, v.p - take);
        left -= take;
      });
    }
  }
  const finance = econStep(MONTH);
  recordBudgetMonth(income, finance);
  S.monthIndex = (S.monthIndex + 1) % 12;
  if (S.monthIndex === 0) {
    const completed = S.year;
    S.year++;
    closeBudgetYear(completed);
  }
  evaluate();
  if (S.en.def > 0.005 && !S.fl.def) {
    S.fl.def = 1;
    logEv("Не хватает электроэнергии, предприятия встают. Нужны новые станции");
  } else if (S.en.def <= 0.001) S.fl.def = 0;
  if (S.en.imp > 0.5 && !S.fl.imp) {
    S.fl.imp = 1;
    logEv("Своих станций не хватает, область покупает электроэнергию у соседей");
  } else if (S.en.imp <= 0.1) S.fl.imp = 0;
  cs.forEach((c) => {
    if (c.spec !== c.lastSpec) {
      if (c.lastSpec && c.spec) logEv("Город " + c.name + " стал " + (SPEC_INS[c.spec] || c.spec));
      c.lastSpec = c.spec;
    }
    if (c.health < 0.7 && c.P > 3000 && !c.flags.hl) {
      c.flags.hl = 1;
      logEv("В городе " + c.name + " не хватает больниц");
    }
    if (c.health > 0.9) c.flags.hl = 0;
    if (c.air && c.paxLoad > 1.1 && !c.flags.pax) {
      c.flags.pax = 1;
      logEv("Аэропорт города " + c.name + " перегружен, нужен терминал");
    }
    if (c.paxLoad < 0.95) c.flags.pax = 0;
  });
  if (S.year >= YMAX) logEv("Конец столетия. Нажмите «Новая игра» для нового прогона");
}
export function stepYear() {
  for (let m = 0; m < 12 && S.year < YMAX; m++) stepMonth();
}
const THR = [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000];
function milestones(c, prev) {
  THR.forEach((t) => {
    if (prev < t && c.P >= t) logEv("Население города " + c.name + " превысило " + fmtPop(t));
    else if (prev >= t && c.P < t)
      logEv("Население города " + c.name + " опустилось ниже " + fmtPop(t));
  });
  const o = c.P / c.H;
  if (o > 1.01 && !c.flags.def) {
    c.flags.def = 1;
    logEv("В городе " + c.name + " не хватает жилья, цены пошли вверх");
  }
  if (o < 0.97 && c.flags.def) c.flags.def = 0;
  if (S.year >= c.grace && c.aband > 0.08 * (c.builtCells + c.aband) && !c.flags.ab) {
    c.flags.ab = 1;
    logEv("В городе " + c.name + " пустует заметная часть застройки");
  }
}
export function logEv(t) {
  if (!S) return;
  S.log.unshift({ y: S.year, t });
  if (S.log.length > 120) S.log.pop();
}
export function init(seed, opts?) {
  opts = opts || {};
  setAcc(0);
  setLastGameDate("");
  setRng(mulberry32(seed));
  const cultureId = opts.cultureId || "RU",
    culture = cultureById(cultureId);
  setS({
    tg: opts.tg || 2,
    planet: !!opts.planet,
    worldVersion: opts.worldVersion === 1 ? 1 : 2,
    adminMapVersion: opts.adminMapVersion === 1 ? 1 : 2,
    cultureId,
    continentCount: opts.continentCount || 5,
    continentNameStyle: opts.continentNameStyle || "geographic",
    foreignCount: 0,
    ruralPool: opts.ruralPool == null ? (opts.planet ? 1e6 : 0) : opts.ruralPool,
    ruralFlow: 0,
    trade: { imports: 0, exports: 0, balance: 0 },
    fl: {},
    regionName: opts.regionName || "",
    year: opts.year || 2026,
    monthIndex: 0,
    cities: [],
    roads: [],
    airRoutes: [],
    cargoRoutes: [],
    regions: [],
    districts: [],
    districtById: null,
    parks: [],
    log: [],
    sel: 0,
    seed,
    budget: 12,
    income: 0,
    budgetBook: { current: { year: opts.year || 2026, income: {}, expense: {} }, last: null },
    extNet: 0,
    names: opts.planet ? culture.cities.filter((n) => n !== opts.capName) : NAMES.slice(),
    slot: opts.slot || 0,
    prices: opts.prices ? Object.assign({}, opts.prices) : basePrices(),
    out: zeroGoods(),
    use: zeroGoods(),
  });
  S.prevPrices = S.prices;
  if (S.planet) {
    P.inflow = 0;
    P.pull = 1;
    const inf = $("#p_inflow"),
      pull = $("#p_pull");
    if (inf) {
      inf.value = "0";
      $("#o_inflow").textContent = "0 тыс./год";
    }
    if (pull) {
      pull.value = "1";
      $("#o_pull").textContent = "×1,0";
    }
  }
  document
    .querySelectorAll(".param")
    .forEach(
      (el) =>
        ((el as HTMLElement).hidden =
          S.planet && ["inflow", "pull"].includes((el as HTMLElement).dataset.param)),
    );
  S.T = makeTerrain();
  if (S.tg >= 2 && !S.planet) makeWorld2(S.T, seed);
  if (S.planet) {
    makePlanet(S.T, seed, S.continentCount, S.continentNameStyle, S.worldVersion);
    makeAdminDistrictMap(seed, S.adminMapVersion);
  }
  placeDeposits();
  S.ext = [];
  for (let k = S.names.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [S.names[k], S.names[j]] = [S.names[j], S.names[k]];
  }
  let best = null,
    bestLand = null;
  const sampleStep = Math.max(3, RW / 512);
  for (let x = 10; x <= RW - 10; x += sampleStep)
    for (let y = 30; y <= RH - 30; y += sampleStep) {
      if (S.planet && (seaD(x, y) < 2 || isIceAt(x, y))) continue;
      const rd = riverDist(x, y);
      const score = Math.hypot(x - RW / 2, y - RH / 2) + forestVal(x, y) * 30;
      if (!bestLand || score < bestLand.s) bestLand = { x, y, s: score };
      if (rd < 1.2 || rd > 2.6) continue;
      if (!best || score < best.s) best = { x, y, s: score };
    }
  if (!best) best = bestLand;
  if (!best) best = { x: RW / 2, y: RH / 2 };
  if (opts.bare) return;
  const cap = opts.capName || CAPS[S.slot] || CAPS[0],
    cx = Number.isFinite(opts.capX) ? opts.capX : best.x,
    cy = Number.isFinite(opts.capY) ? opts.capY : best.y;
  const c = makeCity({ name: cap, x: cx, y: cy, pop: S.planet ? 100000 : 30000 });
  c.hosp = 1;
  (c as any).govc = 1;
  (c as any).pw = { tec: 1 };
  if (S.planet) {
    const ids = initialDistrictIds(cx, cy, 5),
      reg = {
        name: "Регион 1",
        color: DCOL[0],
        cities: [c.i],
        center: c.i,
        manualCities: [],
        districts: [],
      };
    S.regions.push(reg);
    ids.forEach((id) => claimDistrict(id, 0, 200000, false));
    (c as any).districtId = districtAt(cx, cy);
    const cd = S.districtById.get((c as any).districtId);
    if (cd) cd.centerCity = c.i;
    const town = startingTownSite(cx, cy, ids);
    if (town) {
      const nm = S.names.pop() || "Новый город";
      const tc = makeCity({ name: nm, x: town.x, y: town.y, pop: 10000 });
      (tc as any).init = 0.72;
      const td = districtRecordAt(town.x, town.y);
      if (td && !td.centerCity) td.centerCity = tc.i;
    }
    S.ruralPool = 1e6;
    makeRuralSites(S.seed, S.ruralPool);
  }
  S.ext = S.planet ? [] : makeExternal(S.foreignCount, c);
  setLastPairs([]);
  evaluate();
  S.income = S.cities.reduce((s, c) => s + c.P * 2e-5, 0);
  S.log.push({
    y: S.year,
    t:
      "Основана столица «" +
      cap +
      "» (" +
      (S.planet ? "100 тыс." : "30 тыс.") +
      " жителей)" +
      (S.planet
        ? " и город «" +
          (S.cities[1] ? S.cities[1].name : "Новый город") +
          "» с 10 тыс. жителей. В государство включены пять районов первого региона."
        : ". Государство основано вокруг столицы"),
  });
  if (worldText()) S.log.unshift({ y: S.year, t: "Карта: " + worldText() });
  buildTerrainImg();
}
