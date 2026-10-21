import { S } from "./state";
import { clamp } from "./util";

export const PLANT = {
  tec: {
    t: "ТЭЦ",
    mw: 50,
    cost: 4,
    fuel: { gas: 1.2 },
    jobs: 400,
    ind: 4,
    d: "на газе, 50 МВт и тепло для города",
  },
  gres: {
    t: "ГРЭС",
    mw: 400,
    cost: 22,
    fuel: { coal: 7 },
    jobs: 1500,
    ind: 12,
    d: "на угле, 400 МВт",
  },
  ges: {
    t: "ГЭС",
    mw: 250,
    cost: 30,
    fuel: {},
    jobs: 300,
    ind: 4,
    d: "на реке, 250 МВт без топлива",
  },
  aes: {
    t: "АЭС",
    mw: 1000,
    cost: 80,
    fuel: {},
    jobs: 3500,
    ind: 16,
    d: "1000 МВт, нужен вуз уровня 3 в области",
  },
  wind: {
    t: "Ветропарк",
    mw: 60,
    cost: 7,
    fuel: {},
    jobs: 60,
    ind: 0,
    d: "60 МВт, на побережье и в степи сильнее",
  },
  solar: { t: "Солнечная станция", mw: 40, cost: 4, fuel: {}, jobs: 40, ind: 0, d: "40 МВт" },
};
const ENT_MW = {
  oilf: 8,
  gasf: 6,
  coalm: 10,
  orem: 12,
  cum: 12,
  aum: 6,
  potm: 10,
  quarry: 4,
  spa: 2,
  agro: 2,
  lph: 2,
  steel: 80,
  npz: 30,
  chem: 40,
  food: 5,
  paper: 15,
  cem: 15,
  mach: 15,
  elec: 10,
};
export function plantMW(c, k) {
  const p = PLANT[k],
    n = (c.pw && c.pw[k]) || 0;
  let f = 1;
  if (k === "wind") f = (c.coast ? 1 : 0.7) * (S.T.biome === "степь" ? 1.15 : 1);
  if (k === "solar") f = S.T.biome === "степь" ? 1.2 : S.T.biome === "тайга" ? 0.75 : 1;
  return p.mw * n * f;
}
export function energy() {
  let cap = 0,
    nf = 0;
  const fuel = {},
    byT = {},
    cnt = {};
  S.cities.forEach((c) => {
    for (const k in PLANT) {
      const n = (c.pw && c.pw[k]) || 0;
      if (!n) continue;
      const mw = plantMW(c, k);
      cap += mw;
      byT[k] = (byT[k] || 0) + mw;
      cnt[k] = (cnt[k] || 0) + n;
      if (!Object.keys(PLANT[k].fuel).length) nf += mw;
      for (const g in PLANT[k].fuel) fuel[g] = (fuel[g] || 0) + PLANT[k].fuel[g] * n;
    }
  });
  let Dp = 0,
    Di = 0;
  S.cities.forEach((c) => {
    Dp += (0.42 * (c.P + c.R)) / 1000;
    Di += 0.0025 * ((c.jobs && c.jobs.ind) || 0) + 0.002 * ((c.jobs && c.jobs.mine) || 0);
    (c.ent || []).forEach((e) => {
      Di += (ENT_MW[e.k] || 0) * e.u;
    });
  });
  const D = Dp + Di,
    short = Math.max(0, D - cap),
    imp = Math.min(short, 0.15 * D),
    def = D > 0 ? (short - imp) / D : 0,
    fs = cap - nf > 0 ? clamp((D - nf) / (cap - nf), 0, 1) : 0,
    fu = {};
  for (const g in fuel) fu[g] = fuel[g] * fs;
  S.en = {
    cap,
    D,
    Dp,
    Di,
    imp,
    def,
    fuel: fu,
    byT,
    cnt,
    exp: Math.max(0, cap - D),
    served: Math.min(D, cap) + imp,
  };
}
