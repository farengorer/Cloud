import {
  addGridRail,
  addGridRoad,
  addIndustry,
  extCandidates,
  extendLine,
  makeCity,
  newLine,
  newLineBlocked,
  placeRunway,
  recomputeH,
  stations,
} from "./city";
import {
  ACT,
  DEPOSIT_REACH,
  MAXC,
  PORT_MAX_LEVEL,
  RH,
  RIVER_PORT_REACH,
  RW,
  SEA_PORT_REACH,
  ST,
  UNI,
} from "./config";
import { countryAt, districtArea, districtRecordAt } from "./districts";
import { render, roadClass } from "./draw";
import { PLANT, plantMW } from "./energy";
import {
  AIR_DAYS_MONTH,
  MAX_BRIDGE,
  airRouteCost,
  bridgeSpan,
  byKey,
  evaluate,
  flightsPerMonth,
  geoXY,
  linkBetween,
  linkKm,
  logEv,
  nearX,
  roadWaterError,
} from "./model";
import { inPark } from "./saveload";
import { S } from "./state";
import {
  cargoRouteStats,
  portCapacity,
  portLevel,
  portLevelName,
  riverDist,
  riverPortAccess,
  seaPortAccess,
} from "./terrain";
import { $, fmtCargoTonnes } from "./util";
import { isIceAt, mtVal, seaD } from "./worldgen";

export function costOf(c, k) {
  if (k === "uni") return 3 * ((c.uni || 0) + 1);
  if (k === "station") return [1.5, 1.5, 3, 6, 10, 10][c.station || 0];
  if (k === "seaPortUpgrade") return 2 + 2 * (portLevel(c, "sea") || 1);
  if (k === "riverPortUpgrade") return 1.5 + 1.25 * (portLevel(c, "river") || 1);
  return ACT[k].cost;
}
export function capIdx() {
  const k = S.cities.findIndex((c) => c.govc);
  return k < 0 ? 0 : k;
}
export function stPen(o) {
  return o.ext ? 0 : [25, 15, 10, 6, 3, 1][o.station || 1];
}
export function financeBook() {
  if (!S.budgetBook || !S.budgetBook.current)
    S.budgetBook = { current: { year: S.year, income: {}, expense: {} }, last: null, history: [] };
  const book = S.budgetBook,
    b = book.current;
  b.year = Number.isFinite(b.year) ? b.year : S.year;
  b.income = b.income || {};
  b.expense = b.expense || {};
  if (!Array.isArray(book.history)) book.history = book.last ? [book.last] : [];
  return book;
}
function bookAmount(group, key, value) {
  if (!(value > 0)) return;
  const b = financeBook().current[group];
  b[key] = (b[key] || 0) + value;
}
export function spend(v, category = "construction") {
  if (S.budget < v) return false;
  S.budget -= v;
  bookAmount("expense", category, v);
  return true;
}
export function refund(v, category = "construction") {
  S.budget += v;
  const e = financeBook().current.expense;
  e[category] = Math.max(0, (e[category] || 0) - v);
}
const ACTION_EXPENSE = {
  hosp: "health",
  uni: "education",
  mus: "culture",
  gmus: "culture",
  lc: "logistics",
  seaPort: "ports",
  seaPortUpgrade: "ports",
  riverPort: "ports",
  riverPortUpgrade: "ports",
  tech: "industry",
  air: "airportBuild",
  runway: "airportBuild",
  term: "airportBuild",
  station: "railBuild",
  govc: "administration",
  hq: "administration",
  sci: "research",
  sez: "businessDistrict",
  pl_tec: "energyBuild",
  pl_gres: "energyBuild",
  pl_ges: "energyBuild",
  pl_aes: "energyBuild",
  pl_wind: "energyBuild",
  pl_solar: "energyBuild",
};
export const ROAD_CLASS_LABELS = {
    local: "местная",
    regional: "региональная",
    national: "национальная",
    international: "международная",
  },
  ROAD_COST_MULT = { local: 0.68, regional: 1, national: 1.55, international: 2.35 };
export function selectedRoadClass() {
  const el = $("#roadClassSelect");
  return el && ROAD_CLASS_LABELS[el.value] ? el.value : "regional";
}
export function linkCost(a, b, mode, upgrade, roadType?) {
  const scale = S.planet ? 0.01 : 1;
  if (mode === "rail") return (upgrade ? 0.25 : 0.15) * linkKm(a, b) * 1.25 * scale;
  const cls = roadType || selectedRoadClass();
  return (upgrade ? 0.12 : 0.06 * (ROAD_COST_MULT[cls] || 1)) * linkKm(a, b) * 1.25 * scale;
}
export function buildLink(a, b, mode, roadType) {
  let r = linkBetween(a, b, mode);
  if (r) {
    r.fast = true;
    return;
  }
  S.roads.push({
    a,
    b,
    mode,
    fast: false,
    ...(mode === "road" ? { class: roadType || "regional" } : {}),
  });
  const A = byKey(a),
    B = byKey(b);
  if (mode === "rail") {
    if (!A.ext && !A.station) {
      A.station = 1;
      logEv("Город " + A.name + ": открыта железнодорожная станция");
    }
    if (!B.ext && !B.station) {
      B.station = 1;
      logEv("Город " + B.name + ": открыта железнодорожная станция");
    }
  }
  const ax = A.ext ? A.gx : A.x,
    ay = A.ext ? A.gy : A.y,
    tx0 = B.ext ? B.gx : B.x,
    tx = S.planet ? nearX(tx0, ax) : tx0,
    ty = B.ext ? B.gy : B.y,
    th = Math.atan2(ty - ay, tx - ax);
  if (mode === "road") {
    if (!A.ext) addGridRoad(A, th);
    if (!B.ext) addGridRoad(B, Math.atan2(ay - ty, ax - tx));
  } else {
    if (!A.ext) addGridRail(A, th);
    if (!B.ext) addGridRail(B, Math.atan2(ay - ty, ax - tx));
  }
}
function annualInfrastructureCosts() {
  const out: Record<string, any> = {};
  S.roads.forEach((r) => {
    if (r.mode === "road") {
      const cls = roadClass(r),
        rate = { local: 0.025, regional: 0.03, national: 0.036, international: 0.042 }[cls] || 0.03,
        k = "roadMaintain_" + cls;
      out[k] = (out[k] || 0) + linkCost(r.a, r.b, "road", false, cls) * rate * (r.fast ? 1.35 : 1);
    } else
      out.railMaintain =
        (out.railMaintain || 0) + linkCost(r.a, r.b, "rail", false) * 0.035 * (r.fast ? 1.3 : 1);
  });
  S.cities.forEach((c) => {
    if (c.air)
      out.airOperations = (out.airOperations || 0) + 0.004 * (c.term || 1) + (c.runway ? 0.008 : 0);
  });
  (S.airRoutes || []).forEach((r) => {
    const daily = flightsPerMonth(r) / AIR_DAYS_MONTH;
    out.airOperations = (out.airOperations || 0) + airRouteCost(r.a, r.b) * (0.025 + 0.004 * daily);
  });
  (S.cargoRoutes || []).forEach((r) => {
    const st = cargoRouteStats(r);
    if (st) out.cargoOperations = (out.cargoOperations || 0) + st.capacity * 0.000000006;
  });
  const territoryCost = (S.districts || []).reduce(
    (n, d) => n + (d.upkeep || districtArea(d.id) * 0.000002),
    0,
  );
  if (territoryCost) out.territory = territoryCost;
  if (S.en) out.energyGeneration = Math.max(0, Math.min(S.en.D || 0, S.en.cap || 0)) * 0.00055;
  return out;
}
export const MONTH = 1 / 12;
export function monthRate(rate) {
  return rate <= -1 ? -1 : Math.pow(1 + rate, MONTH) - 1;
}
export function recordBudgetMonth(populationIncome, fin) {
  const book = financeBook(),
    cur = book.current;
  bookAmount("income", "population", populationIncome * MONTH);
  [
    ["enterprise", fin.enterprise || 0],
    ["energy", fin.energy || 0],
    ["trade", fin.trade || 0],
  ].forEach(([k, v]) => {
    if (v >= 0) bookAmount("income", k, v);
    else bookAmount("expense", k, -v);
  });
  const maintenance = annualInfrastructureCosts();
  Object.keys(maintenance).forEach((k) => bookAmount("expense", k, maintenance[k] * MONTH));
  const total = (o) => Object.values<any>(o).reduce((a, v) => a + (Number(v) || 0), 0),
    incomeTotal = total(cur.income),
    expenseTotal = total(cur.expense),
    operating =
      Object.values<any>(maintenance).reduce((a, v) => a + v * MONTH, 0) +
      Math.max(0, -(fin.enterprise || 0)) +
      Math.max(0, -(fin.energy || 0)) +
      Math.max(0, -(fin.trade || 0));
  S.budget +=
    populationIncome * MONTH +
    Math.max(0, fin.enterprise || 0) +
    Math.max(0, fin.energy || 0) +
    Math.max(0, fin.trade || 0) -
    operating;
  S.income = (incomeTotal - expenseTotal) / Math.max(MONTH, MONTH * (S.monthIndex + 1));
}
export function closeBudgetYear(year) {
  const book = financeBook(),
    cur = book.current,
    total = (o) => Object.values<any>(o).reduce((a, v) => a + (Number(v) || 0), 0);
  S.income = total(cur.income) - total(cur.expense);
  book.last = {
    year,
    income: Object.assign({}, cur.income),
    expense: Object.assign({}, cur.expense),
  };
  book.history.push(book.last);
  if (book.history.length > 100) book.history.splice(0, book.history.length - 100);
  book.current = { year: year + 1, income: {}, expense: {} };
}
export function canFound(x, y) {
  if ((!S.planet && (x < 5 || x > RW - 5)) || y < 5 || y > RH - 5)
    return "слишком близко к границе";
  if (S.T.sea && seaD(x, y) < 1) return "в море строить нельзя";
  if (S.planet && countryAt(x, y) !== 0) return "эта территория относится к другому государству";
  if (S.planet && !districtRecordAt(x, y)) return "сначала присоедините этот район к государству";
  if (S.planet && isIceAt(x, y)) return "в полярных льдах города не строятся";
  if (S.T.ridge && mtVal(x, y) > 0.55) return "слишком высоко в горах";
  if (inPark(x, y)) return "здесь охраняемая природная территория";
  if (riverDist(x, y) < 0.5) return "на реке строить нельзя";
  for (const c of S.cities)
    if (Math.hypot(c.x - x, c.y - y) < 7) return "слишком близко к городу " + c.name;
  if (S.cities.length >= MAXC) return "в области уже " + MAXC + " городов";
  return "";
}
export function foundCost(x, y) {
  let bi = 0,
    bd = 1e9,
    any = 0,
    ad = Infinity,
    connected = false;
  S.cities.forEach((c, i) => {
    const d = S.planet ? geoXY(c.x, c.y, x, y) : Math.hypot(c.x - x, y - c.y);
    if (d < ad) {
      ad = d;
      any = i;
    }
    if ((!S.planet || bridgeSpan(c.x, c.y, x, y) <= MAX_BRIDGE) && d < bd) {
      bd = d;
      bi = i;
      connected = true;
    }
  });
  if (!connected) {
    bi = any;
    bd = ad;
  }
  const cityCost = 3 + (S.planet ? 0.0006 : 0.06) * bd * 1.25,
    roadCost = connected ? 0.06 * bd * 1.25 * (S.planet ? 0.01 : 1) * ROAD_COST_MULT.local : 0;
  return { near: bi, cityCost, roadCost, cost: cityCost + roadCost, connected };
}
export function found(x, y) {
  const why = canFound(x, y);
  if (why) return;
  const fc = foundCost(x, y);
  if (S.budget < fc.cost) return;
  spend(fc.cityCost, "construction");
  if (fc.roadCost) spend(fc.roadCost, "road_local");
  const name = S.names.shift() || "Город " + (S.cities.length + 1);
  const c = makeCity({ name, x, y, pop: 600, cap: 5200, grace: true, init: 0.5, rural: 400 });
  if (fc.connected && !roadWaterError(fc.near, c.i)) buildLink(fc.near, c.i, "road", "local");
  const sh = [];
  if ((c as any).soilSh > 0.3) sh.push("чернозёмы");
  if ((c as any).forestSh > 0.3) sh.push("леса");
  if ((c as any).river) sh.push("река");
  logEv(
    "Основан город " +
      name +
      (sh.length ? " (" + sh.join(", ") + ")" : "") +
      ", дорога до города " +
      S.cities[fc.near].name,
  );
  S.sel = c.i;
  evaluate();
}
function nearDeposits(c) {
  const reach = S.planet ? DEPOSIT_REACH : 18;
  return S.T.deps.filter(
    (d) =>
      (d.used || 0) < 2 &&
      (d.res == null || d.res > 0) &&
      (!S.planet || countryAt(d.x, d.y) === 0) &&
      (S.planet ? geoXY(d.x, d.y, c.x, c.y) : Math.hypot(d.x - c.x, d.y - c.y)) <= reach,
  );
}
export function canAct(c, k) {
  const a = ACT[k];
  if (k.startsWith("pl_")) {
    const q = k.slice(3);
    if (q === "ges" && !c.river) return "нужна река";
    if (q === "ges" && (c.pw.ges || 0) >= 2) return "на реке у города уже две";
    if (q === "aes" && (c.pw.aes || 0) >= 1) return "уже есть";
    if (q === "aes" && !S.cities.some((o) => (o.uni || 0) >= 3))
      return "нужен вуз уровня 3 в области";
    if (S.budget < costOf(c, k)) return "не хватает денег";
    return "";
  }
  if (k === "tech" && !c.uni) return "нужен вуз";
  if (k === "dep" && !nearDeposits(c).length)
    return "нет свободного месторождения в радиусе " + (S.planet ? DEPOSIT_REACH : 18) + " км";
  if (k === "mline" && c.P < 250000) return "от 250 тыс. жителей";
  if (k === "mline" && newLineBlocked(c)) return "нет свободного направления";
  if (k === "mext" && !c.metro.length) return "сначала нужна линия";
  if (k === "mext" && !extCandidates(c).length) return "линии упёрлись в край застройки";
  if (k === "uni" && (c.uni || 0) >= 5) return "высший уровень";
  if (k === "tech" && (c.uni || 0) < 2) return "нужен вуз уровня 2";
  if (ACT[k].unique && c[k]) return "уже здесь";
  if (ACT[k].unique && k !== "govc") {
    const o = S.cities.find((o) => o[k]);
    if (o) return "уже есть: " + o.name;
  }
  if (k === "sci" && (c.uni || 0) < 3) return "нужен вуз уровня 3";
  if (k === "station" && !c.station) return "сначала проведите железную дорогу";
  if (k === "station" && c.station >= 5) return "высший уровень";
  if (k === "air" && c.air) return "уже есть";
  if (k === "air" && c.P < 20000) return "от 20 тыс. жителей";
  if (k === "runway" && !c.air) return "сначала аэропорт";
  if (k === "runway" && c.runway) return "ВПП уже 3000 м";
  if (k === "seaPort" && portLevel(c, "sea")) return "уже построен";
  if (k === "seaPort" && !seaPortAccess(c.x, c.y).ok)
    return "побережье дальше " + SEA_PORT_REACH + " км";
  if (k === "seaPortUpgrade" && !portLevel(c, "sea")) return "сначала морской порт";
  if (k === "seaPortUpgrade" && portLevel(c, "sea") >= PORT_MAX_LEVEL)
    return "максимальный уровень";
  if (k === "riverPort" && portLevel(c, "river")) return "уже построен";
  if (k === "riverPort" && !riverPortAccess(c.x, c.y).ok)
    return "река дальше " + RIVER_PORT_REACH + " км";
  if (k === "riverPortUpgrade" && !portLevel(c, "river")) return "сначала речной порт";
  if (k === "riverPortUpgrade" && portLevel(c, "river") >= PORT_MAX_LEVEL)
    return "максимальный уровень";
  if (k === "gmus" && c.gmus) return "в городе уже есть";
  if (k === "gmus" && c.P < 100000) return "от 100 тыс. жителей";
  if (k === "gmus" && S.cities.reduce((a, o) => a + (o.gmus || 0), 0) >= 3)
    return "в области уже три";
  if (k === "lc" && S.roads.filter((r) => r.a === c.i || r.b === c.i).length < 2)
    return "нужны хотя бы две дороги или ж/д";
  if (k === "term" && !c.air) return "сначала аэропорт";
  if (S.budget < costOf(c, k)) return "не хватает денег";
  return "";
}
export function doAct(c, k) {
  if (canAct(c, k)) return;
  const a = ACT[k];
  spend(costOf(c, k), ACTION_EXPENSE[k] || "construction");
  let msg = "";
  if (k === "hosp") {
    c.hosp++;
    msg = "открыта больница, всего " + c.hosp;
  } else if (k === "uni") {
    c.uni = (c.uni || 0) + 1;
    msg = "вуз теперь " + UNI[c.uni];
  } else if (k === "mus") {
    c.mus++;
    msg = "открыт музей или театр, всего " + c.mus;
  } else if (k === "park") {
    c.park++;
    addIndustry(c, 14);
    msg = "создан индустриальный парк";
  } else if (k === "tech") {
    c.tech++;
    addIndustry(c, 8);
    msg = "открыт технопарк";
  } else if (k === "dep") {
    const d = nearDeposits(c).sort(
      (p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y),
    )[0];
    d.dev = c.i;
    addIndustry(c, 10);
    msg = "начата добыча, " + d.t;
  } else if (k === "mline") {
    newLine(c);
    msg = "открыта " + c.metro.length + "-я линия метро";
  } else if (k === "mext") {
    extendLine(c);
    msg = "открыта станция метро, всего " + stations(c);
  } else if (k === "air") {
    c.air = 1;
    c.term = 1;
    placeRunway(c);
    msg = "открыт аэропорт с ВПП 1800 м";
  } else if (k === "runway") {
    c.runway = 1;
    msg = "ВПП удлинена до 3000 м, открыты рейсы в столицу";
  } else if (k === "gmus") {
    c.gmus = 1;
    msg = "открыт великий музей, туристы поедут со всей страны";
  } else if (k === "lc") {
    c.lc = (c.lc || 0) + 1;
    addIndustry(c, 10);
    msg = "открыт логистический комплекс, всего " + c.lc;
  } else if (k === "seaPort") {
    c.seaPortLevel = 1;
    c.port = 1;
    addIndustry(c, 8);
    msg =
      "открыт морской порт, грузооборот до " + fmtCargoTonnes(portCapacity(c, "sea")) + " в год";
  } else if (k === "seaPortUpgrade") {
    c.seaPortLevel++;
    msg =
      "морской порт повышен до уровня " +
      portLevelName(c.seaPortLevel) +
      ", грузооборот до " +
      fmtCargoTonnes(portCapacity(c, "sea")) +
      " в год";
  } else if (k === "riverPort") {
    c.riverPortLevel = 1;
    c.port = 1;
    addIndustry(c, 6);
    msg =
      "открыт речной порт, грузооборот до " + fmtCargoTonnes(portCapacity(c, "river")) + " в год";
  } else if (k === "riverPortUpgrade") {
    c.riverPortLevel++;
    msg =
      "речной порт повышен до уровня " +
      portLevelName(c.riverPortLevel) +
      ", грузооборот до " +
      fmtCargoTonnes(portCapacity(c, "river")) +
      " в год";
  } else if (k.startsWith("pl_")) {
    const q = k.slice(3);
    c.pw[q] = (c.pw[q] || 0) + 1;
    if (PLANT[q].ind) addIndustry(c, PLANT[q].ind);
    msg =
      "построена станция: " +
      PLANT[q].t +
      ", " +
      Math.round(plantMW(Object.assign({}, c, { pw: { [q]: 1 } }), q)) +
      " МВт";
  } else if (k === "govc") {
    S.cities.forEach((o) => (o.govc = 0));
    c.govc = 1;
    msg = "сюда переехало правительство области";
  } else if (k === "hq" || k === "sci" || k === "sez") {
    c[k] = 1;
    msg = "размещено: " + a.t.toLowerCase();
  } else if (k === "station") {
    c.station++;
    msg = "железная дорога: теперь " + ST[c.station];
  } else if (k === "term") {
    c.term++;
    msg = "открыт терминал, пропускная способность " + c.term + " млн пассажиров";
  }
  recomputeH(c);
  logEv("Город " + c.name + ": " + msg);
  evaluate();
  render();
}
