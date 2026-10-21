import { ENT, GOODS, entJobs } from "./economy";
import { PLANT, plantMW } from "./energy";
import { S } from "./state";
import { $, esc, fmtCargoTonnes, fmtM, fmtN } from "./util";

export const DEP_RES = {
  oil: 600,
  gas: 800,
  coal: 900,
  ore: 700,
  cu: 300,
  au: 60,
  pot: 600,
  stone: 2000,
  spa: 1e9,
};
const CONC = {
  ind: 0.28,
  mine: 0.6,
  agro: 0.18,
  wood: 0.3,
  it: 0.2,
  tour: 0.12,
  log: 0.22,
  serv: 0.035,
};
const RPW = {
  ind: 0.007,
  mine: 0.02,
  agro: 0.004,
  wood: 0.005,
  it: 0.009,
  tour: 0.004,
  log: 0.006,
  serv: 0.004,
};
const FIRMN = {
  ind: (n) => "Машиностроительный завод «" + n + "»",
  mine: (n) => "Горная компания «" + n + "»",
  agro: (n) => "Агрофирма «" + n + "»",
  wood: (n) => "Лесозавод «" + n + "»",
  it: (n) => "«" + n + " Софт»",
  tour: (n) => "Туристический комплекс «" + n + "»",
  log: (n) => "Транспортная компания «" + n + "»",
  serv: (n) => "Торговая сеть «" + n + "»",
};
function bigFirms() {
  const out = [];
  S.cities.forEach((c) => {
    const ej = entJobs(c);
    (c.ent || []).forEach((e) => {
      const d = ENT[e.k];
      out.push({
        n: d.t + " «" + c.name + "»",
        c: c.name,
        s: d.sec,
        j: d.jobs * e.u * (c.LR || 1),
        r: e.rev || 0,
        own: 1,
      });
    });
    for (const k in PLANT) {
      const n = (c.pw && c.pw[k]) || 0;
      if (n)
        out.push({
          n: PLANT[k].t + (n > 1 ? "-" + n : "") + " «" + c.name + "»",
          c: c.name,
          s: "en",
          j: PLANT[k].jobs * n,
          r: plantMW(c, k) * 0.006,
          own: 1,
        });
    }
    for (const k in CONC) {
      const rest = Math.max(0, (c.jobs[k] || 0) - (ej[k] || 0));
      const j = rest * CONC[k];
      if (j >= 250) out.push({ n: FIRMN[k](c.name), c: c.name, s: k, j, r: j * RPW[k] });
    }
  });
  return out.sort((a, b) => b.j - a.j).slice(0, 10);
}
const SECN = {
  ind: "промышленность",
  mine: "добыча",
  agro: "сельское хоз.",
  wood: "лес",
  it: "IT и наука",
  tour: "туризм",
  log: "логистика",
  serv: "торговля и услуги",
  en: "энергетика",
};
export function drawFirms() {
  const tb = $("#firmBody");
  if (!tb) return;
  const html =
    bigFirms()
      .map(
        (f, i) =>
          "<tr><td>" +
          (i + 1) +
          '</td><td class="l" style="white-space:normal">' +
          esc(f.n) +
          (f.own ? ' <span class="label">ваше</span>' : "") +
          '</td><td class="l s">' +
          SECN[f.s] +
          "</td><td>" +
          fmtN(f.j) +
          "</td><td>" +
          fmtM(f.r) +
          "</td></tr>",
      )
      .join("") || '<tr><td class="empty" colspan="5">Крупных компаний пока нет.</td></tr>';
  if (tb.dataset.h !== html) {
    tb.innerHTML = html;
    tb.dataset.h = html;
  }
}
export function drawEnergy() {
  const box = $("#enBody");
  if (!box || !S.en) return;
  const e = S.en,
    f = (v) => fmtN(v) + " МВт";
  const rows = Object.keys(PLANT)
    .filter((k) => e.cnt[k])
    .map(
      (k) =>
        '<tr><td class="l">' +
        PLANT[k].t +
        "</td><td>" +
        e.cnt[k] +
        "</td><td>" +
        fmtN(e.byT[k]) +
        '</td><td class="l s">' +
        (Object.keys(PLANT[k].fuel)
          .map(
            (g) =>
              GOODS[g].t.toLowerCase() +
              " " +
              fmtCargoTonnes((e.fuel[g] || 0) * GOODS[g].tonnes) +
              "/год",
          )
          .join(", ") || "–") +
        "</td></tr>",
    )
    .join("");
  const st =
    e.def > 0.005
      ? '<b class="down">Дефицит ' +
        Math.round(e.def * 100) +
        "%</b>: предприятия работают с недогрузкой, города теряют привлекательность. Постройте новые станции в карточке города."
      : e.imp > 0.5
        ? '<b class="down">Покупка у соседей ' +
          f(e.imp) +
          "</b>, это дорого. Соседи продают не больше 15% потребности."
        : '<b class="up">Резерв ' +
          Math.round((e.cap / Math.max(1, e.D) - 1) * 100) +
          "%</b>" +
          (e.exp > 1 ? ", излишки продаются соседям." : ".");
  const html =
    '<p class="note">Потребление <b>' +
    f(e.D) +
    "</b>: население " +
    f(e.Dp) +
    ", промышленность и добыча " +
    f(e.Di) +
    ". Мощность <b>" +
    f(e.cap) +
    "</b>. " +
    st +
    "</p>" +
    '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Станции</th><th>Шт.</th><th>МВт</th><th class="l">Топливо в год</th></tr></thead><tbody>' +
    (rows || '<tr><td class="empty" colspan="4">Станций нет.</td></tr>') +
    "</tbody></table></div>" +
    '<p class="note">ТЭЦ закрывает около 100 тыс. жителей. Топливные станции работают только на ту часть спроса, которую не покрыли ГЭС, АЭС, ветер и солнце, и сжигают газ и уголь с общего рынка. Выручка от продажи энергии идёт в бюджет; эксплуатация действующей собственной мощности добавляет около ' +
    fmtM(Math.max(0, Math.min(e.D || 0, e.cap || 0)) * 0.00055) +
    " расходов в год и отражается в бюджетной ведомости.</p>";
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
function ownShare(g) {
  const o = (S.out && S.out[g]) || 0,
    u = (S.use && S.use[g]) || 0;
  return u > 0 ? Math.min(1, o / u) : 1;
}
export function drawChains() {
  const box = $("#chainBody");
  if (!box) return;
  const grp = {},
    flow = (g, v) => GOODS[g].t.toLowerCase() + " " + fmtCargoTonnes(v * GOODS[g].tonnes) + "/год";
  S.cities.forEach((c) =>
    (c.ent || []).forEach((e) => {
      const d = ENT[e.k];
      if (!d.inp) return;
      const key = e.k + "|" + c.i;
      const g = (grp[key] = grp[key] || { d, c, n: 0, u: 0 });
      g.n++;
      g.u += e.u * (c.LR || 1) * (1 - (S.en ? S.en.def : 0));
    }),
  );
  const line = (title, inp, out) =>
    "<li><b>" +
    title +
    "</b><br>" +
    inp
      .map(([g, v]) => {
        const sh = ownShare(g);
        return (
          flow(g, v) +
          ' <span class="' +
          (sh > 0.99 ? "up" : sh < 0.01 ? "down" : "") +
          '">(' +
          (sh > 0.99 ? "своё" : sh < 0.01 ? "ввоз" : "своё " + Math.round(sh * 100) + "%") +
          ")</span>"
        );
      })
      .join(" + ") +
    (out ? " → " + out : "") +
    "</li>";
  let html = Object.values<any>(grp)
    .map((g) =>
      line(
        (g as any).d.t + ((g as any).n > 1 ? " ×" + (g as any).n : "") + " · " + (g as any).c.name,
        Object.keys((g as any).d.inp).map((k) => [k, (g as any).d.inp[k] * (g as any).u]),
        Object.keys((g as any).d.out)
          .map((k) => flow(k, (g as any).d.out[k] * (g as any).u))
          .join(", "),
      ),
    )
    .join("");
  const fu = S.en ? Object.keys(S.en.fuel).filter((g) => S.en.fuel[g] > 0.01) : [];
  if (fu.length)
    html += line(
      "Электростанции",
      fu.map((g) => [g, S.en.fuel[g]]),
      fmtN(S.en.served) + " МВт",
    );
  const pop = S.cities.reduce((a, c) => a + c.P + c.R, 0);
  html += line(
    "Население",
    [
      ["food", pop / 1e5],
      ["fuel", (pop / 1e5) * 0.6],
    ],
    "",
  );
  const ub = S.useBy && S.useBy.build;
  if (ub && (ub.cem > 0.01 || ub.steel > 0.01))
    html += line(
      "Стройка",
      [
        ["cem", ub.cem],
        ["steel", ub.steel],
      ],
      "",
    );
  html =
    '<ul class="chain">' +
    html +
    '</ul><p class="note">«Своё» значит, что в области этого товара производится достаточно. Нехватку область ввозит по рыночной цене, своё сырьё переработчикам обходится на 15% дешевле.</p>';
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
export function drawDeps() {
  const box = $("#depBody");
  if (!box) return;
  const ext = {};
  S.cities.forEach((c) =>
    (c.ent || []).forEach((e) => {
      if (e.dep != null) {
        ext[e.dep] =
          (ext[e.dep] || 0) +
          Object.values<any>(ENT[e.k].out).reduce((a, b) => a + b, 0) * e.u * (c.LR || 1);
      }
    }),
  );
  const rows = S.T.deps
    .map((d, i) => ({
      d,
      i,
      near: S.cities.reduce((b, c) => {
        const v = Math.hypot(c.x - d.x, c.y - d.y);
        return !b || v < b.v ? { c, v } : b;
      }, null),
    }))
    .filter((o) => (o.near && o.near.v <= 40) || ext[o.i])
    .sort((a, b) => (ext[b.i] || 0) - (ext[a.i] || 0) || a.near.v - b.near.v)
    .slice(0, 14)
    .map((o) => {
      const r = o.d.res == null ? DEP_RES[o.d.k] : o.d.res,
        x = ext[o.i] || 0,
        mass = GOODS[o.d.k] ? GOODS[o.d.k].tonnes : 0,
        stock = mass ? r * mass : 0,
        rate = mass ? x * mass : 0,
        never = !mass || r > 1e8;
      return (
        '<tr><td class="l">' +
        o.d.t +
        '</td><td class="l s">' +
        esc(o.near.c.name) +
        ", " +
        Math.round(o.near.v) +
        " км</td><td>" +
        (mass ? (r > 1e8 ? "∞" : fmtCargoTonnes(stock)) : "неисчерпаемое") +
        "</td><td>" +
        (mass && x ? fmtCargoTonnes(rate) : "–") +
        "</td><td>" +
        (mass && x && !never ? Math.round(r / x) + " лет" : mass && r <= 0 ? "выработано" : "–") +
        "</td></tr>"
      );
    })
    .join("");
  const html =
    '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Месторождение</th><th class="l">Ближайший город</th><th>Запас, т</th><th>Добыча, т/год</th><th>Хватит</th></tr></thead><tbody>' +
    (rows || '<tr><td class="empty" colspan="5">Рядом с городами месторождений нет.</td></tr>') +
    '</tbody></table></div><p class="note">Запасы и добыча указаны в физических тоннах. Минеральные воды не ограничены запасом. Добывать можно в пределах 18 км от города, выработанное месторождение закрывается.</p>';
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
}
