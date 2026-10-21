import { spend } from "./actions";
import { bfs, bizUpdate, computeForeign, metroUpdate, rasterLine, recomputeH } from "./city";
import { buildTerrainImg, mix, rgb } from "./colors";
import { ABAND, BIZ, CELLKM, EMPTY, G, IZHS, MID, P, RH, RW, SECT } from "./config";
import { rebuildDistrictLookup, restoreTerritory } from "./districts";
import { halo, render, updateGameDate } from "./draw";
import { evaluate, init, logEv } from "./model";
import { S_SOLO, dbw, onRender } from "./multiplayer";
import {
  C,
  CANWRITE,
  DB,
  FONT,
  S,
  UID,
  acc,
  bizMsg,
  lastGameDate,
  lastPairs,
  onMsg,
  pHover,
  pmode,
  setAcc,
  setBizMsg,
  setLastGameDate,
  setLastPairs,
  setOnMsg,
  setPmode,
} from "./state";
import { cultureById, elevVal, hasCargoPort, makeExternal } from "./terrain";
import { clamp } from "./util";
import { toolButtons } from "./views";
import { makeRuralSites } from "./villages";

function rle(grid, forest) {
  let out = [],
    prev = -1,
    n = 0;
  for (let k = 0; k < grid.length; k++) {
    const v = grid[k] * 2 + forest[k];
    if (v === prev) n++;
    else {
      if (n) out.push(prev.toString(36) + "." + n.toString(36));
      prev = v;
      n = 1;
    }
  }
  out.push(prev.toString(36) + "." + n.toString(36));
  return out.join(",");
}
function unrle(str, grid, forest) {
  let k = 0;
  str.split(",").forEach((t) => {
    const [a, b] = t.split(".");
    const v = parseInt(a, 36),
      n = parseInt(b, 36);
    for (let i = 0; i < n && k < grid.length; i++, k++) {
      grid[k] = v >> 1;
      forest[k] = v & 1;
    }
  });
}
const CITY_KEYS = [
  "coast",
  "pw",
  "carryS",
  "name",
  "x",
  "y",
  "P",
  "R",
  "J",
  "founded",
  "grace",
  "hosp",
  "uni",
  "mus",
  "park",
  "tech",
  "air",
  "runway",
  "term",
  "seaPortLevel",
  "riverPortLevel",
  "gmus",
  "lc",
  "port",
  "fact",
  "carryH",
  "carryI",
  "carryA",
  "lastSpec",
  "clark",
  "govc",
  "hq",
  "sci",
  "sez",
  "station",
  "soilSh",
  "forestSh",
  "river",
  "nature",
  "vsize",
  "metroCov",
];
function packCity(c) {
  const o = {};
  CITY_KEYS.forEach((k) => {
    if (c[k] !== undefined) o[k] = c[k];
  });
  o.grid = rle(c.grid, c.forest);
  o.roads = c.roads.map((r) => r.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]));
  o.rails = c.rails;
  o.metro = c.metro;
  o.rw = c.rw;
  o.vsites = c.vsites;
  o.ent = c.ent;
  o.firms = c.firms;
  o.hist = c.hist.map((v) => Math.round(v));
  o.flags = c.flags;
  return o;
}
function unpackCity(o, i) {
  const c = {
    i,
    name: o.name,
    x: o.x,
    y: o.y,
    P: o.P,
    J: 0,
    H: 0,
    founded: o.founded,
    grace: o.grace || 0,
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
    runway: 0,
    term: 0,
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
    hist: [],
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
  CITY_KEYS.forEach((k) => {
    if (o[k] !== undefined) c[k] = o[k];
  });
  if (o.port && !o.seaPortLevel && !o.riverPortLevel) {
    if (c.river) c.riverPortLevel = 1;
    else c.seaPortLevel = 1;
  }
  c.port = hasCargoPort(c) ? 1 : 0;
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const k = gy * G + gx,
        wx = c.x + (gx - c.cx) * CELLKM,
        wy = c.y + (gy - c.cy) * CELLKM;
      c.elev[k] = elevVal(wx, wy) * 0.7 + 0.3 * S.T.nD(wx * 1.5, wy * 1.5);
    }
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
  unrle(o.grid, c.grid, c.forest);
  c.roads = o.roads || [];
  c.roads.forEach((r) => rasterLine(c.roadMask, r));
  bfs(c.roadMask, c.roadD, 30);
  c.rails = o.rails || [];
  c.metro = o.metro || [];
  c.rw = o.rw || null;
  c.vsites = o.vsites || [];
  c.ent = o.ent || [];
  c.hist = o.hist || [o.P];
  c.flags = o.flags || {};
  SECT.forEach((s) => {
    c.firms[s.k] = (o.firms && o.firms[s.k]) || 0;
    c.jobs[s.k] = c.firms[s.k] * s.size;
  });
  c.J = SECT.reduce((a, s) => a + c.jobs[s.k], 0);
  recomputeH(c);
  bizUpdate(c);
  if (c.metro.length) metroUpdate(c);
  return c;
}
export function lsKey(gid) {
  return "verkhnedonsk-save-" + gid;
}
export async function saveGame(gid) {
  if (!DB || !UID) {
    try {
      const meta = {
        v: 4,
        G,
        mapRW: RW,
        mapRH: RH,
        planet: !!S.planet,
        worldVersion: S.worldVersion || 2,
        adminMapVersion: S.adminMapVersion || 2,
        cultureId: S.cultureId || "RU",
        foreignStates: S.ext,
        continentCount: S.continentCount || 5,
        continentNameStyle: S.continentNameStyle || "geographic",
        foreignCount: S.foreignCount || 0,
        ruralPool: S.ruralPool || 0,
        regionName: S.regionName || "",
        parks: S.parks,
        seed: S.seed,
        slot: S.slot || 0,
        year: S.year,
        month: S.monthIndex || 0,
        budget: S.budget,
        budgetBook: S.budgetBook,
        prices: S.prices,
        prevPrices: S.prevPrices || null,
        roads: S.roads,
        airRoutes: S.airRoutes || [],
        cargoRoutes: S.cargoRoutes || [],
        regions: S.regions,
        landDistricts: S.districts,
        log: S.log.slice(0, 40),
        names: S.names,
        deps: S.T.deps.map((d) => d.used || 0),
        depr: S.T.deps.map((d) => (d.res == null ? -1 : Math.round(d.res))),
        tg: S.tg || 1,
        ncity: S.cities.length,
        sel: S.sel,
        t: Date.now(),
      };
      localStorage.setItem(lsKey(gid), JSON.stringify({ meta, cities: S.cities.map(packCity) }));
      S_SOLO.save = { year: S.year };
      setOnMsg("Сохранено в этом браузере, год " + S.year + ".");
    } catch (e) {
      setOnMsg(
        "Не удалось сохранить в браузере. Возможно, включён приватный режим или закончилось место.",
      );
    }
    onRender();
    return;
  }
  if (CANWRITE === false) return;
  const base = "data/users/" + UID + "/save-" + gid;
  const meta = {
    v: 4,
    G,
    mapRW: RW,
    mapRH: RH,
    planet: !!S.planet,
    worldVersion: S.worldVersion || 2,
    adminMapVersion: S.adminMapVersion || 2,
    cultureId: S.cultureId || "RU",
    foreignStates: S.ext,
    continentCount: S.continentCount || 5,
    continentNameStyle: S.continentNameStyle || "geographic",
    foreignCount: S.foreignCount || 0,
    ruralPool: S.ruralPool || 0,
    regionName: S.regionName || "",
    parks: S.parks,
    seed: S.seed,
    slot: S.slot || 0,
    year: S.year,
    month: S.monthIndex || 0,
    budget: S.budget,
    budgetBook: S.budgetBook,
    prices: S.prices,
    prevPrices: S.prevPrices || null,
    roads: S.roads,
    airRoutes: S.airRoutes || [],
    cargoRoutes: S.cargoRoutes || [],
    regions: S.regions,
    landDistricts: S.districts,
    log: S.log.slice(0, 40),
    names: S.names,
    deps: S.T.deps.map((d) => d.used || 0),
    depr: S.T.deps.map((d) => (d.res == null ? -1 : Math.round(d.res))),
    tg: S.tg || 1,
    ncity: S.cities.length,
    sel: S.sel,
    t: Date.now(),
  };
  await dbw(() => DB.doc(base).set(meta));
  for (let i = 0; i < S.cities.length; i++) {
    const body = packCity(S.cities[i]);
    await dbw(() =>
      DB.doc(base)
        .collection("c")
        .doc("c" + i)
        .set(body),
    );
  }
}
export async function loadSave(gid) {
  let m,
    docs = [];
  if (!DB || !UID) {
    try {
      const raw = localStorage.getItem(lsKey(gid));
      if (!raw) return false;
      const o = JSON.parse(raw);
      m = o.meta;
      docs = o.cities;
    } catch (e) {
      return false;
    }
  } else {
    const base = "data/users/" + UID + "/save-" + gid;
    try {
      const s = await DB.doc(base).get();
      if (!s.exists) return false;
      m = s.data();
    } catch (e) {
      return false;
    }
    for (let i = 0; i < m.ncity; i++) {
      try {
        const s = await DB.doc(base)
          .collection("c")
          .doc("c" + i)
          .get();
        if (!s.exists) return false;
        docs.push(s.data());
      } catch (e) {
        return false;
      }
    }
  }
  if ((m.G || 120) !== G || (m.v || 1) < 3) {
    setOnMsg(
      "Это сохранение сделано в старой версии игры с другим размером карты и не может быть загружено.",
    );
    onRender();
    return false;
  }
  const oldMapW = m.mapRW || (m.planet ? 1280 : RW),
    oldMapH = m.mapRH || (m.planet ? 640 : RH),
    resizeSave = !!m.planet && (oldMapW !== RW || oldMapH !== RH);
  if (resizeSave) {
    docs.forEach((d) => {
      d.x = (d.x / oldMapW) * RW;
      d.y = (d.y / oldMapH) * RH;
    });
    m.parks = (m.parks || []).map((p) =>
      Object.assign({}, p, { x: (p.x / oldMapW) * RW, y: (p.y / oldMapH) * RH }),
    );
    m.cargoRoutes = (m.cargoRoutes || []).map((r) =>
      Object.assign({}, r, {
        points: (r.points || []).map((p) => [(p[0] / oldMapW) * RW, (p[1] / oldMapH) * RH]),
      }),
    );
  }
  const worldVersion = Number.isFinite(+m.worldVersion) ? +m.worldVersion : 1,
    adminMapVersion = Number.isFinite(+m.adminMapVersion)
      ? +m.adminMapVersion
      : worldVersion === 1
        ? 1
        : 2;
  init(m.seed, {
    slot: m.slot,
    year: m.year,
    prices: m.prices,
    bare: true,
    tg: m.tg || 1,
    planet: !!m.planet,
    worldVersion,
    adminMapVersion,
    cultureId: m.cultureId || "RU",
    continentCount: m.continentCount || 5,
    continentNameStyle: m.continentNameStyle || "geographic",
    foreignCount: m.foreignCount || 0,
    ruralPool: m.ruralPool || 0,
  });
  S.monthIndex = Number.isFinite(+m.month) ? clamp(+m.month, 0, 11) : 0;
  setAcc(0);
  setLastGameDate("");
  updateGameDate();
  S.budget = m.budget;
  S.budgetBook = m.budgetBook || {
    current: { year: m.year || S.year, income: {}, expense: {} },
    last: null,
  };
  S.prevPrices = m.prevPrices || m.prices;
  S.roads = m.roads || [];
  S.airRoutes = Array.isArray(m.airRoutes) ? m.airRoutes : [];
  S.cargoRoutes = Array.isArray(m.cargoRoutes) ? m.cargoRoutes : [];
  S.regions = m.regions || m.districts || [];
  S.districts = Array.isArray(m.landDistricts) ? m.landDistricts : [];
  rebuildDistrictLookup();
  S.parks = m.parks || [];
  S.regionName = m.regionName || "";
  S.log = m.log || [];
  S.names = m.names || S.names;
  S.sel = Math.min(m.sel || 0, m.ncity - 1);
  (m.deps || []).forEach((u, i) => {
    if (S.T.deps[i]) S.T.deps[i].used = u;
  });
  (m.depr || []).forEach((r, i) => {
    if (S.T.deps[i] && r >= 0) S.T.deps[i].res = r;
  });
  S.cities = docs.map((d, i) => unpackCity(d, i));
  if (S.planet) restoreTerritory();
  if (S.planet && !m.cultureId)
    S.names = cultureById(S.cultureId).cities.filter((n) => !S.cities.some((c) => c.name === n));
  S.ext = S.planet
    ? []
    : Array.isArray(m.foreignStates)
      ? m.foreignStates
      : makeExternal(S.foreignCount, S.cities[0]);
  if (S.planet) makeRuralSites(S.seed, S.ruralPool);
  S.cities.forEach(computeForeign);
  S.cities.forEach((c) => {
    c.pw = c.pw || {};
  });
  if (!S.cities.some((c) => Object.keys(c.pw).length)) {
    const pop = S.cities.reduce((a, c) => a + c.P + c.R, 0),
      cc = S.cities.find((c) => c.govc) || S.cities[0];
    cc.pw = { tec: Math.max(1, Math.ceil((pop * 0.5) / 1000 / 50)) };
  }
  setLastPairs([]);
  evaluate();
  buildTerrainImg();
  logEv("Партия загружена, год " + S.year);
  return true;
}
const PNAMES = [
  "Красный бор",
  "Тихие озёра",
  "Сосновая грива",
  "Медвежий угол",
  "Белые пески",
  "Кедровая падь",
  "Лосиный распадок",
  "Синие камни",
  "Журавлиная пойма",
  "Чёрный яр",
];
export function inPark(x, y) {
  return (S.parks || []).some((p) => Math.hypot(p.x - x, p.y - y) < p.r);
}
export function parkTour(c) {
  let t = 0;
  (S.parks || []).forEach((p) => {
    if (p.type !== "np") return;
    const d = Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - p.r);
    if (d < 45) t += 700 * Math.exp(-d / 15);
  });
  return t;
}
export function parkNature(c) {
  let t = 0;
  (S.parks || []).forEach((p) => {
    const d = Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - p.r);
    if (d < 45) t += (p.type === "np" ? 0.5 : 0.35) * Math.exp(-d / 15);
  });
  return t;
}
export function drawParks(ctx, s) {
  (S.parks || []).forEach((p) => {
    const col = mix(C["s-wood"], C.ink, 0.25);
    ctx.save();
    ctx.fillStyle = rgb(C["s-wood"], p.type === "np" ? 0.14 : 0.24);
    ctx.strokeStyle = rgb(col);
    ctx.lineWidth = p.type === "np" ? 1.8 : 2.4;
    if (p.type === "np") ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.arc(p.x * s, p.y * s, p.r * s, 0, 6.283);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
  if (pmode && pHover) {
    const r = pmode === "np" ? 10 : 12,
      why = parkWhy(pHover.x, pHover.y, r);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = rgb(why ? C.no : C.ok);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pHover.x * s, pHover.y * s, r * s, 0, 6.283);
    ctx.stroke();
    ctx.restore();
    if (why) {
      ctx.font = "12.5px " + FONT.b;
      ctx.fillStyle = rgb(C.ink);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      halo(ctx, why, pHover.x * s + 12, pHover.y * s - 10);
    }
  }
}
function parkWhy(x, y, r) {
  if (x < r || y < r || x > RW - r || y > RH - r) return "слишком близко к границе";
  if (S.cities.some((c) => Math.hypot(c.x - x, c.y - y) < r + 3)) return "слишком близко к городу";
  if ((S.parks || []).some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r))
    return "пересекается с другой охраняемой территорией";
  if (S.budget < (pmode === "np" ? 2 : 1)) return "не хватает денег";
  return "";
}
export function placePark(m) {
  const r = pmode === "np" ? 10 : 12;
  if (parkWhy(m.x, m.y, r)) return;
  spend(pmode === "np" ? 2 : 1, "parks");
  const name = PNAMES[S.parks.length % PNAMES.length];
  S.parks.push({ x: m.x, y: m.y, r, type: pmode, name });
  logEv((pmode === "np" ? "Создан национальный парк «" : "Создан заповедник «") + name + "»");
  setPmode(null);
  toolButtons();
  evaluate();
  render();
}
export function placeBiz(c, p) {
  const cx = Math.floor(p.x),
    cy = Math.floor(p.y),
    cells = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx,
        y = cy + dy;
      if (x < 0 || y < 0 || x >= G || y >= G) continue;
      const k = y * G + x,
        t = c.grid[k];
      if (
        ((t === EMPTY && !(c.forest[k] && P.forest)) || t === IZHS || t === ABAND || t === MID) &&
        !(c.foreign && c.foreign[k])
      )
        cells.push(k);
    }
  if (cells.length < 5) {
    setBizMsg(
      "Здесь мало места: деловой центр ставится на пустые участки, частный сектор или пятиэтажки.",
    );
    toolButtons();
    return;
  }
  if (!spend(2, "businessDistrict")) {
    setBizMsg("Не хватает денег, квартал стоит 2 млрд.");
    toolButtons();
    return;
  }
  setBizMsg("");
  const first = !c.biz;
  cells.forEach((k) => {
    c.grid[k] = BIZ;
    c.forest[k] = 0;
  });
  recomputeH(c);
  bizUpdate(c);
  if (first) logEv("Город " + c.name + ": появился деловой центр");
  evaluate();
  render();
}
