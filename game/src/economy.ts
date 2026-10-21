import { MONTH, monthRate, spend } from "./actions";
import { addIndustry, clarkFit, recomputeH } from "./city";
import { DEPOSIT_REACH, DEP_T } from "./config";
import { countryAt } from "./districts";
import { render } from "./draw";
import { evaluate, geoXY, logEv } from "./model";
import { DEP_RES } from "./resources";
import { inPark } from "./saveload";
import { MP, S, entSelK, setEntSelK } from "./state";
import { externalCargoCapacity, hasCargoPort, settleCargoFlows } from "./terrain";
import { $, clamp, fmtCargoTonnes, fmtM, fmtN, fmtPop, fmtTonPrice, pct } from "./util";

// p is the batch price in billions of rubles; tonnes is the physical mass of one game batch; w is a market-balancing reference volume.
// Batch masses are game calibrations chosen to give each commodity a distinct, readable price per tonne.
export const GOODS = {
  oil: { t: "Нефть", p: 0.4, w: 60, tonnes: 10000 },
  gas: { t: "Газ", p: 0.25, w: 60, tonnes: 25000 },
  coal: { t: "Уголь", p: 0.15, w: 60, tonnes: 30000 },
  ore: { t: "Железная руда", p: 0.18, w: 60, tonnes: 60000 },
  cu: { t: "Медь", p: 0.6, w: 30, tonnes: 600 },
  au: { t: "Золото", p: 3.0, w: 6, tonnes: 0.3 },
  pot: { t: "Калийная соль", p: 0.22, w: 40, tonnes: 11000 },
  stone: { t: "Камень", p: 0.05, w: 60, tonnes: 17000 },
  grain: { t: "Зерно", p: 0.12, w: 60, tonnes: 8000 },
  wood: { t: "Древесина", p: 0.1, w: 60, tonnes: 10000 },
  steel: { t: "Сталь", p: 0.55, w: 40, tonnes: 11000 },
  fuel: { t: "Топливо", p: 0.55, w: 50, tonnes: 8000 },
  chem: { t: "Химия и удобрения", p: 0.55, w: 40, tonnes: 5500 },
  food: { t: "Продукты питания", p: 0.25, w: 40, tonnes: 5000 },
  paper: { t: "Бумага и мебель", p: 0.25, w: 35, tonnes: 2500 },
  mach: { t: "Машины", p: 1.4, w: 20, tonnes: 5000 },
  elec: { t: "Электроника", p: 1.3, w: 15, tonnes: 200 },
  cem: { t: "Цемент", p: 0.12, w: 40, tonnes: 15000 },
};
export const ENT = {
  oilf: { t: "Нефтепромысел", dep: "oil", out: { oil: 10 }, jobs: 1500, sec: "mine", cost: 5 },
  gasf: { t: "Газопромысел", dep: "gas", out: { gas: 10 }, jobs: 900, sec: "mine", cost: 5 },
  coalm: { t: "Угольная шахта", dep: "coal", out: { coal: 10 }, jobs: 2500, sec: "mine", cost: 4 },
  orem: { t: "Железорудный ГОК", dep: "ore", out: { ore: 10 }, jobs: 2000, sec: "mine", cost: 5 },
  cum: { t: "Медный рудник", dep: "cu", out: { cu: 5 }, jobs: 1800, sec: "mine", cost: 5 },
  aum: { t: "Золотой прииск", dep: "au", out: { au: 1 }, jobs: 1200, sec: "mine", cost: 4 },
  potm: { t: "Калийный рудник", dep: "pot", out: { pot: 8 }, jobs: 1500, sec: "mine", cost: 4 },
  quarry: { t: "Карьер", dep: "stone", out: { stone: 10 }, jobs: 600, sec: "mine", cost: 2 },
  spa: { t: "Санаторий", dep: "spa", out: {}, jobs: 900, sec: "tour", cost: 3, service: 1.4 },
  agro: { t: "Агрохолдинг", need: "soil", out: { grain: 10 }, jobs: 1500, sec: "agro", cost: 3 },
  lph: { t: "Леспромхоз", need: "forest", out: { wood: 10 }, jobs: 1200, sec: "wood", cost: 3 },
  steel: {
    t: "Металлургический комбинат",
    inp: { ore: 10, coal: 6 },
    out: { steel: 8 },
    jobs: 3000,
    sec: "ind",
    cost: 10,
  },
  npz: {
    t: "Нефтеперерабатывающий завод",
    inp: { oil: 10 },
    out: { fuel: 9 },
    jobs: 1500,
    sec: "ind",
    cost: 9,
  },
  chem: {
    t: "Химический комбинат",
    inp: { gas: 8, pot: 4 },
    out: { chem: 8 },
    jobs: 2000,
    sec: "ind",
    cost: 9,
  },
  food: {
    t: "Пищевой комбинат",
    inp: { grain: 10 },
    out: { food: 8 },
    jobs: 1500,
    sec: "ind",
    cost: 4,
  },
  paper: {
    t: "Деревообработка и ЦБК",
    inp: { wood: 10 },
    out: { paper: 7 },
    jobs: 1500,
    sec: "ind",
    cost: 5,
  },
  cem: {
    t: "Цементный завод",
    inp: { stone: 10 },
    out: { cem: 8 },
    jobs: 800,
    sec: "ind",
    cost: 3,
  },
  mach: {
    t: "Машиностроительный завод",
    inp: { steel: 6 },
    out: { mach: 4 },
    jobs: 4000,
    sec: "ind",
    cost: 12,
    minP: 50000,
  },
  elec: {
    t: "Завод электроники",
    inp: { cu: 2 },
    out: { elec: 3 },
    jobs: 2500,
    sec: "it",
    cost: 10,
    uni: 1,
  },
};
const WAGE = 0.0004;
export function basePrices() {
  const p = {};
  for (const g in GOODS) p[g] = GOODS[g].p;
  return p;
}
export function zeroGoods() {
  const o = {};
  for (const g in GOODS) o[g] = 0;
  return o;
}
function foreignMarket() {
  const out = zeroGoods(),
    use = zeroGoods();
  S.ext.forEach((e) => {
    for (const g in GOODS) {
      out[g] += (e.tradeOut && e.tradeOut[g]) || 0;
      use[g] += (e.tradeUse && e.tradeUse[g]) || 0;
    }
  });
  if (S.planet && !S.ext.length) {
    for (const g in GOODS) {
      out[g] = ((S.lastUse && S.lastUse[g]) || 0) * 0.35;
      use[g] = ((S.lastOut && S.lastOut[g]) || 0) * 0.35;
    }
  }
  return { out, use };
}
function settleTrade(out, use, fm, capacity) {
  let imports = 0,
    exports = 0,
    volume = 0;
  const byGood = {};
  for (const g in GOODS) {
    const ex = Math.min(Math.max(0, (out[g] || 0) - (use[g] || 0)), fm.use[g] || 0),
      im = Math.min(Math.max(0, (use[g] || 0) - (out[g] || 0)), fm.out[g] || 0);
    volume += (ex + im) * GOODS[g].tonnes;
    byGood[g] = { exports: ex, imports: im };
  }
  const demand = volume,
    scale = volume ? Math.min(1, Math.max(0, capacity) / volume) : 0;
  for (const g in GOODS) {
    const q = byGood[g];
    q.exports *= scale;
    q.imports *= scale;
    exports += q.exports * S.prices[g];
    imports += q.imports * S.prices[g];
  }
  volume = demand * scale;
  return {
    imports,
    exports,
    balance: exports - imports,
    byGood,
    volume,
    demand,
    capacity,
    load: capacity ? volume / capacity : 0,
  };
}
export function priceTarget(out, use) {
  const p = {};
  for (const g in GOODS) {
    const G_ = GOODS[g];
    p[g] = G_.p * clamp(Math.pow((G_.w + (use[g] || 0)) / (G_.w + (out[g] || 0)), 0.45), 0.35, 3);
  }
  return p;
}
export function smoothPrices(old, tg, rate = 0.4) {
  const p = {};
  for (const g in GOODS) {
    const o = (old && old[g]) || GOODS[g].p;
    p[g] = +(o * (1 - rate) + tg[g] * rate).toFixed(4);
  }
  return p;
}
export function entJobs(c) {
  const j = {};
  (c.ent || []).forEach((e) => {
    const d = ENT[e.k];
    j[d.sec] = (j[d.sec] || 0) + d.jobs * e.u;
  });
  return j;
}
function depFor(c, type) {
  let best = null,
    bd = 1e9;
  S.T.deps.forEach((d, i) => {
    if (S.planet && countryAt(d.x, d.y) !== 0) return;
    if (d.k !== type || (d.used || 0) >= 2 || inPark(d.x, d.y) || (d.res != null && d.res <= 0))
      return;
    const dd = S.planet ? geoXY(d.x, d.y, c.x, c.y) : Math.hypot(d.x - c.x, d.y - c.y),
      reach = S.planet ? DEPOSIT_REACH : 18;
    if (dd <= reach && dd < bd) {
      bd = dd;
      best = i;
    }
  });
  return best;
}
function entWhy(c, k) {
  const d = ENT[k];
  if (d.dep && depFor(c, d.dep) == null) {
    const t = DEP_T.find((x) => x.k === d.dep).t;
    return (
      "нет свободного месторождения («" +
      t +
      "») в радиусе " +
      (S.planet ? DEPOSIT_REACH : 18) +
      " км"
    );
  }
  if (d.need === "soil" && c.soilSh < 0.2) return "вокруг мало чернозёма";
  if (d.need === "forest" && c.forestSh < 0.2) return "вокруг мало леса";
  if (d.minP && c.P < d.minP) return "нужен город от " + fmtPop(d.minP);
  if (d.uni && (c.uni || 0) < 2) return "нужен вуз уровня 2 в городе";
  if (S.budget < d.cost) return "не хватает денег";
  return "";
}
function localDiscount(g) {
  return S.lastOut &&
    S.lastUse &&
    (S.lastOut[g] || 0) >= (S.lastUse[g] || 0) * 0.999 &&
    (S.lastOut[g] || 0) > 0
    ? 0.85
    : 1;
}
function entEstimate(c, k, u) {
  const d = ENT[k],
    pr = S.prices;
  u = u == null ? 1 : u;
  let rev = 0,
    cost = 0;
  for (const g in d.out) rev += d.out[g] * u * pr[g];
  for (const g in d.inp || {}) cost += d.inp[g] * u * pr[g] * localDiscount(g);
  if (d.service) rev += d.service * u * (c.air ? 1.3 : 1) * (c.airLevel >= 4 ? 1.2 : 1);
  if (hasCargoPort(c) && !d.service) rev *= 1.06;
  if (c.sez && !d.service) rev *= 1.15;
  if (c.lc && d.inp) rev *= 1 + 0.04 * Math.min(c.lc, 3);
  return { rev, cost, wages: d.jobs * u * WAGE, profit: rev - cost - d.jobs * u * WAGE };
}
function buildEnt(c, k) {
  if (entWhy(c, k)) return;
  const d = ENT[k];
  spend(d.cost, "industry");
  const e: Record<string, any> = { k, u: 0.5, profit: 0, rev: 0 };
  if (d.dep) {
    const di = depFor(c, d.dep);
    e.dep = di;
    S.T.deps[di].used = (S.T.deps[di].used || 0) + 1;
  }
  c.ent.push(e);
  if (d.sec === "ind" || d.sec === "mine" || d.sec === "it")
    addIndustry(c, Math.round(4 + d.jobs / 300));
  recomputeH(c);
  logEv("Город " + c.name + ": построен " + d.t.charAt(0).toLowerCase() + d.t.slice(1));
  evaluate();
  render();
}
function closeEnt(c, i) {
  const e = c.ent[i];
  if (!e) return;
  if (e.dep != null && S.T.deps[e.dep])
    S.T.deps[e.dep].used = Math.max(0, (S.T.deps[e.dep].used || 1) - 1);
  c.ent.splice(i, 1);
  logEv("Город " + c.name + ": закрыт " + ENT[e.k].t.charAt(0).toLowerCase() + ENT[e.k].t.slice(1));
  evaluate();
  render();
}
export function econStep(monthScale = MONTH) {
  const pr = S.prices,
    out = zeroGoods(),
    use = zeroGoods();
  let tax = 0,
    energyBalance = 0,
    tradeBalance = 0,
    bc = 0,
    bs = 0;
  S.cities.forEach((c) => {
    c.goodsOut = zeroGoods();
    c.goodsUse = zeroGoods();
    const labor = 0.55 * (c.P + 0.5 * c.R),
      LR = clamp(labor / Math.max(1, c.J), 0.35, 1);
    c.LR = LR;
    (c.ent || []).forEach((e) => {
      const d = ENT[e.k];
      let ue = e.u * LR * (1 - (S.en ? S.en.def : 0));
      if (e.dep != null && S.T.deps[e.dep] && !d.service) {
        const dp = S.T.deps[e.dep];
        if (dp.res == null) dp.res = DEP_RES[dp.k];
        if (dp.res <= 0) ue = 0;
        else {
          dp.res = Math.max(
            0,
            dp.res - Object.values<any>(d.out).reduce((a, b) => a + b, 0) * ue * monthScale,
          );
          if (dp.res <= 0)
            logEv(
              "Город " +
                c.name +
                ": месторождение выработано, " +
                d.t.toLowerCase() +
                " остановлен",
            );
        }
      }
      const est = entEstimate(c, e.k, ue);
      const wages = d.jobs * e.u * WAGE,
        profit = est.rev - est.cost - wages;
      for (const g in d.out) {
        out[g] += d.out[g] * ue;
        c.goodsOut[g] += d.out[g] * ue;
      }
      for (const g in d.inp || {}) {
        use[g] += d.inp[g] * ue;
        c.goodsUse[g] += d.inp[g] * ue;
      }
      e.rev = est.rev;
      e.profit = profit;
      tax += Math.max(0, profit) * 0.25 + (d.dep && !d.service ? est.rev * 0.12 : 0);
      const was = e.u;
      e.u = clamp(e.u + monthRate(profit < 0 ? -0.15 : 0.08), 0.2, 1);
      if (was > 0.25 && e.u <= 0.2 && !e.warned) {
        e.warned = 1;
        logEv("Город " + c.name + ": " + d.t.toLowerCase() + " работает в убыток и почти встал");
      }
      if (e.u > 0.5) e.warned = 0;
    });
    (use as any).cem += (c.lastBuild || 0) / (2500 * monthScale);
    (use as any).steel += (c.lastBuild || 0) / (9000 * monthScale);
    bc += (c.lastBuild || 0) / (2500 * monthScale);
    bs += (c.lastBuild || 0) / (9000 * monthScale);
    (use as any).food += (c.P + c.R) / 1e5;
    (use as any).fuel += ((c.P + c.R) / 1e5) * 0.6;
    c.goodsUse.food += (c.P + c.R) / 1e5;
    c.goodsUse.fuel += ((c.P + c.R) / 1e5) * 0.6;
    c.goodsUse.cem += (c.lastBuild || 0) / (2500 * monthScale);
    c.goodsUse.steel += (c.lastBuild || 0) / (9000 * monthScale);
  });
  const ruralCity = S.cities.find((c) => c.govc) || S.cities[0];
  (use as any).food += (S.ruralPool || 0) / 1e5;
  (use as any).fuel += ((S.ruralPool || 0) / 1e5) * 0.6;
  if (ruralCity) {
    ruralCity.goodsUse.food += (S.ruralPool || 0) / 1e5;
    ruralCity.goodsUse.fuel += ((S.ruralPool || 0) / 1e5) * 0.6;
  }
  S.useBy = { build: { cem: bc, steel: bs } };
  if (S.en) {
    let fc = 0;
    const popTotal = Math.max(
      1,
      S.cities.reduce((n, c) => n + c.P + c.R, 0),
    );
    for (const g in S.en.fuel) {
      use[g] += S.en.fuel[g];
      fc += S.en.fuel[g] * pr[g];
      S.cities.forEach((c) => (c.goodsUse[g] += (S.en.fuel[g] * (c.P + c.R)) / popTotal));
    }
    const em = S.en.served * 0.006 - S.en.imp * 0.016 + S.en.exp * 0.002 - fc;
    S.en.money = em;
    energyBalance = em;
    tax += em;
  }
  S.lastOut = out;
  S.lastUse = use;
  S.out = out;
  S.use = use;
  S.entTax = tax;
  const cargo = settleCargoFlows();
  if (!MP) {
    const fm = foreignMarket(),
      worldOut = zeroGoods(),
      worldUse = zeroGoods(),
      portCapacityLeft = externalCargoCapacity();
    for (const g in GOODS) {
      worldOut[g] = out[g] + fm.out[g];
      worldUse[g] = use[g] + fm.use[g];
    }
    S.trade = settleTrade(cargo.out, cargo.use, fm, portCapacityLeft);
    tradeBalance = S.trade.balance;
    tax += tradeBalance;
    S.prevPrices = S.prices;
    S.prices = smoothPrices(S.prices, priceTarget(worldOut, worldUse), 0.4 * monthScale);
  } else
    S.trade = {
      imports: 0,
      exports: 0,
      balance: 0,
      volume: 0,
      capacity: externalCargoCapacity(),
      demand: 0,
      load: 0,
    };
  S.entTax = tax - energyBalance - tradeBalance;
  return {
    enterprise: (tax - energyBalance - tradeBalance) * monthScale,
    energy: energyBalance * monthScale,
    trade: tradeBalance * monthScale,
  };
}
export function regionQ() {
  const cs = S.cities;
  let a = 0,
    w = 0;
  cs.forEach((c) => {
    const p = c.P + c.R;
    a +=
      p *
      (0.6 * c.health +
        0.3 * c.edu +
        0.15 * Math.log(1 + c.cult) +
        0.4 * Math.log(clamp(c.J / Math.max(1, 0.5 * c.P), 0.3, 2)) -
        Math.log(c.price));
    w += p;
  });
  return w ? a / w : 0;
}
export function drawClark(c) {
  const box = $("#clarkBox");
  if (!box) return;
  const cur = clarkFit(c),
    all = c.clark || [],
    hist = all.length > 12 ? [all[0]].concat(all.slice(-11)) : all;
  const f = (v) => v.toFixed(2).replace(".", ",");
  if (!cur) {
    box.innerHTML = '<p class="note">Город пока слишком мал для оценки.</p>';
    return;
  }
  const row = (x) =>
    '<tr><td class="l">' +
    x.y +
    (x.first ? " (старт)" : "") +
    "</td><td>" +
    f(x.D0 / 1000) +
    "</td><td>" +
    f(x.b) +
    "</td><td>" +
    f(x.r2) +
    "</td><td>" +
    x.R +
    "</td></tr>";
  const html =
    '<p class="note">Модель Кларка D(r) = D₀·e<sup>−br</sup> по валовой плотности в кольцах шириной 1 км. Сейчас плотность в центре <b>' +
    f(cur.D0 / 1000) +
    " тыс. чел./км²</b>, градиент <b>" +
    f(cur.b) +
    " 1/км</b>, R² " +
    f(cur.r2) +
    ". Растущий D₀ означает уплотнение центра, падающий b означает расползание. Первый замер фиксируется при основании, дальше каждые 10 лет.</p>" +
    (hist.length
      ? '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Год</th><th>D₀, тыс./км²</th><th>b, 1/км</th><th>R²</th><th>Радиус, км</th></tr></thead><tbody>' +
        hist.map(row).join("") +
        "</tbody></table></div>"
      : '<p class="note">Первый замер появится в ближайший год, кратный десяти.</p>');
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
export function drawProd(c) {
  const box = $("#prodBox");
  if (!box) return;
  const grp = {};
  (c.ent || []).forEach((e, i) => {
    (grp[e.k] = grp[e.k] || { n: 0, u: 0, p: 0, last: i }).n++;
    grp[e.k].u += e.u;
    grp[e.k].p += e.profit || 0;
    grp[e.k].last = i;
  });
  const rows = Object.keys(grp)
    .map((k) => {
      const g = grp[k],
        d = ENT[k],
        cl = g.p >= 0 ? "up" : "down";
      return (
        '<tr><td class="l">' +
        d.t +
        (g.n > 1 ? " ×" + g.n : "") +
        "</td><td>" +
        Math.round((g.u / g.n) * (c.LR || 1) * 100) +
        '%</td><td class="' +
        cl +
        '">' +
        (g.p >= 0 ? "+" : "") +
        g.p.toFixed(2).replace(".", ",") +
        '</td><td><button class="link" type="button" data-close="' +
        g.last +
        '">закрыть ' +
        (g.n > 1 ? "одно" : "") +
        "</button></td></tr>"
      );
    })
    .join("");
  const keys = Object.keys(ENT);
  if (!entSelK || !ENT[entSelK])
    setEntSelK(keys.find((k) => !entWhy(c, k) || entWhy(c, k) === "не хватает денег") || keys[0]);
  const opt = (k) => {
    const w = entWhy(c, k),
      bad = w && w !== "не хватает денег";
    return (
      '<option value="' +
      k +
      '"' +
      (k === entSelK ? " selected" : "") +
      ">" +
      ENT[k].t +
      (bad ? " (недоступно)" : "") +
      "</option>"
    );
  };
  const sel =
    '<select id="entSel" aria-label="Что построить"><optgroup label="Добыча и сырьё">' +
    keys
      .filter((k) => !ENT[k].inp)
      .map(opt)
      .join("") +
    '</optgroup><optgroup label="Переработка">' +
    keys
      .filter((k) => ENT[k].inp)
      .map(opt)
      .join("") +
    "</optgroup></select>";
  const d = ENT[entSelK],
    why = entWhy(c, entSelK),
    est = entEstimate(c, entSelK, 1);
  const showFlow = (g, q) => GOODS[g].t.toLowerCase() + ": " + fmtCargoTonnes(q * GOODS[g].tonnes),
    io =
      (d.inp
        ? Object.keys(d.inp)
            .map((g) => showFlow(g, d.inp[g]))
            .join(" + ") + " → "
        : "") +
      (d.service
        ? "курортные услуги"
        : Object.keys(d.out)
            .map((g) => showFlow(g, d.out[g]))
            .join(", "));
  const info =
    '<p class="note">' +
    io +
    " в год, " +
    fmtN(d.jobs) +
    ' рабочих мест. При нынешних ценах прибыль около <b class="' +
    (est.profit >= 0 ? "up" : "down") +
    '">' +
    (est.profit >= 0 ? "+" : "") +
    est.profit.toFixed(2).replace(".", ",") +
    " млрд</b> в год" +
    (d.inp ? ", сырьё покупается на рынке, а своё в области обходится на 15% дешевле" : "") +
    ". " +
    (why && why !== "не хватает денег" ? '<span class="down">' + why + ".</span>" : "") +
    "</p>";
  const html =
    (rows
      ? '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Предприятие</th><th>Загрузка</th><th>Прибыль, млрд</th><th></th></tr></thead><tbody>' +
        rows +
        "</tbody></table></div>"
      : '<p class="note">Предприятий пока нет. Выберите, что производить.</p>') +
    '<div class="roadrow">' +
    sel +
    '<button type="button" id="entBuild"' +
    (why ? " disabled" : "") +
    ">Построить · " +
    fmtM(d.cost) +
    "</button></div>" +
    info;
  const sig = c.i + "|" + html;
  if (
    box.dataset.sig !== sig &&
    document.activeElement &&
    document.activeElement.id === "entSel" &&
    box.contains(document.activeElement)
  )
    return;
  if (box.dataset.sig !== sig) {
    box.innerHTML = html;
    box.dataset.sig = sig;
  }
}
/* market table */
export function drawMarket() {
  const tb = $("#mktBody");
  if (!tb) return;
  const pr = S.prices,
    pp = S.prevPrices || pr,
    out = S.out || {},
    use = S.use || {};
  let tot = null;
  if (MP) {
    tot = { o: zeroGoods(), u: zeroGoods() };
    Object.values<any>(MP.regions).forEach((r) => {
      for (const g in GOODS) {
        tot.o[g] += ((r as any).out && (r as any).out[g]) || 0;
        tot.u[g] += ((r as any).use && (r as any).use[g]) || 0;
      }
    });
  }
  $("#mktAll").hidden = !MP;
  const html = Object.keys(GOODS)
    .map((g) => {
      const ch = pr[g] / pp[g] - 1,
        cl = ch > 0.005 ? "up" : ch < -0.005 ? "down" : "",
        o = out[g] || 0,
        u = use[g] || 0,
        b = o - u,
        tonnes = GOODS[g].tonnes,
        mass = (v) => (v * tonnes > 0 ? fmtCargoTonnes(v * tonnes) : "–"),
        bal = Math.abs(b * tonnes) > 0.001;
      return (
        '<tr><td class="l">' +
        GOODS[g].t +
        "</td><td>" +
        fmtCargoTonnes(tonnes) +
        "</td><td>" +
        fmtTonPrice((pr[g] * 1e9) / tonnes) +
        '</td><td class="' +
        cl +
        '">' +
        (Math.abs(ch) < 0.0005 ? "·" : pct(ch, 0)) +
        "</td><td>" +
        mass(o) +
        "</td><td>" +
        mass(u) +
        '</td><td class="' +
        (b > 0.000001 ? "up" : b < -0.000001 ? "down" : "") +
        '">' +
        (!bal ? "·" : (b > 0 ? "+" : "−") + fmtCargoTonnes(Math.abs(b) * tonnes)) +
        "</td>" +
        (tot ? "<td>" + mass(tot.o[g]) + "</td>" : "") +
        "</tr>"
      );
    })
    .join("");
  if (tb.dataset.h !== html) {
    tb.innerHTML = html;
    tb.dataset.h = html;
  }
  const ts = $("#tradeSummary");
  if (ts) {
    ts.hidden = false;
    ts.textContent =
      "Масса партии — физический вес игровой производственной партии. Цена за тонну рассчитывается из текущей цены партии; денежные расчёты производства сохранены.";
  }
}

export function setupEconomy() {
  $("#prodBox").addEventListener("change", (e) => {
    if (e.target.id === "entSel") {
      setEntSelK(e.target.value);
      e.target.blur();
      drawProd(S.cities[S.sel]);
    }
  });
  $("#prodBox").addEventListener("click", (e) => {
    const c = S.cities[S.sel];
    if (e.target.id === "entBuild") {
      buildEnt(c, entSelK);
      return;
    }
    const cl = e.target.closest("[data-close]");
    if (cl) closeEnt(c, +cl.dataset.close);
  });
}
