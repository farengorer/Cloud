import { ARAMP, accRegion } from "./accessibility";
import { planCity } from "./agglomerations";
import { stations } from "./city";
import { hex, mix, rgb } from "./colors";
import {
  ABAND,
  CAP,
  CELLKM,
  DEPOSIT_REACH,
  EMPTY,
  G,
  HIST,
  IND,
  RH,
  RW,
  SKY,
  WATER,
} from "./config";
import { RC, mapPos } from "./controls";
import { countryAt } from "./districts";
import { V, drawViewportImage } from "./draw";
import { CC, cityPos } from "./metro";
import { geoXY, nearX, wrapX } from "./model";
import { inPark } from "./saveload";
import { APP_PREFS, C, CLAYER, LAYER, S, TT, VIEW, bdraw, mdraw } from "./state";
import { BIOMES, areaShares, riverPortAccess, seaPortAccess, soilVal } from "./terrain";
import { $, clamp, esc, fmtN, fmtT } from "./util";
import { villages } from "./villages";

const DRAMP = ["#FFF1C9", "#FBC56B", "#EE8A3C", "#C94F2B", "#7A2420"],
  LRAMP = ["#E6F2EC", "#A3D5C3", "#4FA0A3", "#2D668A", "#2D2D69"];
const DRH = DRAMP.map(hex),
  LRH = LRAMP.map(hex);
export function ramp(st, t) {
  t = clamp(t, 0, 1) * (st.length - 1);
  const i = Math.min(st.length - 2, Math.floor(t)),
    f = t - i;
  return mix(st[i], st[i + 1], f);
}
export function fmtRub(v) {
  return v >= 1000
    ? (v / 1000).toFixed(v < 10000 ? 1 : 0).replace(".", ",") + " тыс. ₽/м²"
    : Math.round(v) + " ₽/м²";
}
function fmtDens(v) {
  return v < 10 ? v.toFixed(1).replace(".", ",") + " чел./км²" : fmtN(v) + " чел./км²";
}
/* land price index at the centre of a city: grows with size and with a tight housing market */
export function landBase(c) {
  return 1200 * Math.pow(Math.max(c.P, 2000) / 1e4, 0.55) * Math.sqrt(clamp(c.price || 1, 0.3, 6));
}
export const HEAT: Record<string, any> = {
  dk: "",
  lk: "",
  dens: null,
  land: null,
  dimg: null,
  limg: null,
};
export const DENS_W = 1200,
  DENS_H = 600,
  DENS_DETAIL_SCALE = 0.9;
function heatImg(arr, W, H, f) {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const r = f(arr[k]);
    if (!r) continue;
    const p = k * 4;
    im.data[p] = r[0];
    im.data[p + 1] = r[1];
    im.data[p + 2] = r[2];
    im.data[p + 3] = r[3];
  }
  x.putImageData(im, 0, 0);
  return cv;
}
export function densRegion() {
  const key = S.year + "|" + S.cities.length + "|" + S.cities.reduce((a, c) => a + c.builtCells, 0);
  if (HEAT.dk === key && HEAT.dimg) return HEAT.dimg;
  HEAT.dk = key;
  const W = DENS_W,
    H = DENS_H,
    a = new Float32Array(W * H),
    add = (x, y, p) => {
      if (S.planet) x = wrapX(x);
      if (x < 0 || x >= RW || y < 0 || y >= RH) return;
      const ix = Math.floor((x / RW) * W),
        iy = Math.floor((y / RH) * H);
      a[iy * W + ix] += p;
    };
  S.cities.forEach((c) => {
    const occ = Math.min(1.06, c.P / Math.max(1, c.H));
    for (let k = 0; k < G * G; k++) {
      const cp = CAP[c.grid[k]];
      if (!cp) continue;
      add(c.x + ((k % G) - c.cx) * CELLKM, c.y + (((k / G) | 0) - c.cy) * CELLKM, cp * occ);
    }
    villages(c).forEach((v) => add(v.x, v.y, v.p));
  });
  (S.ruralSites || []).forEach((v) => add(v.x, v.y, v.p));
  const cellArea = ((RW / W) * RH) / H;
  for (let y = 0; y < H; y++) {
    const area = cellArea * Math.max(0.08, Math.sin((Math.PI * (y + 0.5)) / H)),
      off = y * W;
    for (let x = 0; x < W; x++) a[off + x] /= area;
  }
  HEAT.dens = a;
  HEAT.dimg = heatImg(a, W, H, (v) => {
    if (v < 1) return null;
    const t = Math.log10(v) / 4;
    const r = ramp(DRH, t);
    return [r[0], r[1], r[2], Math.round(255 * (0.45 + 0.5 * clamp(t, 0, 1)))];
  });
  return HEAT.dimg;
}
function densityDetailAt(x, y) {
  let best = 0;
  for (const c of S.cities) {
    const wx = S.planet ? nearX(x, c.x) : x,
      x0 = c.x - c.cx * CELLKM,
      y0 = c.y - c.cy * CELLKM,
      ix = Math.floor((wx - x0) / CELLKM),
      iy = Math.floor((y - y0) / CELLKM);
    if (ix < 0 || iy < 0 || ix >= G || iy >= G) continue;
    cityHeat(c, "dens");
    const v = c.heatArr[iy * G + ix];
    if (v > best) best = v;
  }
  for (const v of S.ruralSites || []) {
    const rad = clamp(0.25 + Math.sqrt(v.p) / 90, 0.3, 2.5);
    if (geoXY(x, y, v.x, v.y) <= rad) best = Math.max(best, v.p / (Math.PI * rad * rad));
  }
  return best;
}
export function drawDensityDetail(ctx, s, shift, w, h, OX, OY) {
  const left = -OX / s - shift,
    right = (w - OX) / s - shift,
    top = -OY / s,
    bottom = (h - OY) / s,
    spot = (v) => {
      if (v.p < 25) return;
      const rad = clamp(0.25 + Math.sqrt(v.p) / 90, 0.3, 2.5),
        den = v.p / (Math.PI * rad * rad),
        col = ramp(DRH, Math.log10(Math.max(1, den) / 300) / 2.3);
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = rgb(col);
      ctx.shadowColor = rgb(col);
      ctx.shadowBlur = Math.max(1, rad * s * 0.35);
      ctx.beginPath();
      ctx.arc(v.x * s, v.y * s, Math.max(0.7, rad * s), 0, 6.283);
      ctx.fill();
      ctx.restore();
    };
  S.cities.forEach((c) => {
    const x = c.x - c.cx * CELLKM,
      y = c.y - c.cy * CELLKM,
      side = G * CELLKM;
    if (x + side < left || x > right || y + side < top || y > bottom) return;
    const img = cityHeat(c, "dens");
    ctx.save();
    ctx.imageSmoothingEnabled = s < 2;
    ctx.drawImage(img, x * s, y * s, side * s, side * s);
    ctx.restore();
    villages(c).forEach(spot);
  });
  (S.ruralSites || []).forEach((v) => {
    if (v.x >= left - 3 && v.x <= right + 3 && v.y >= top - 3 && v.y <= bottom + 3) spot(v);
  });
}
export function landRegion() {
  const key =
    S.year +
    "|" +
    S.cities.length +
    "|" +
    S.roads.length +
    "|" +
    S.roads.filter((r) => r.fast).length +
    "|" +
    (S.parks || []).length;
  if (HEAT.lk === key && HEAT.limg) return HEAT.limg;
  HEAT.lk = key;
  const W = 160,
    H = 120,
    a = new Float32Array(W * H),
    cs = S.cities,
    n = cs.length,
    base = cs.map(landBase);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const wx = ((gx + 0.5) * RW) / W,
        wy = ((gy + 0.5) * RH) / H;
      const near = cs
        .map((c, k) => ({ k, d: Math.hypot(c.x - wx, c.y - wy) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      let u = 0;
      for (let j = 0; j < n; j++) {
        let t = 1e9;
        near.forEach((o) => {
          const tl = (75 * o.d) / 30 + 3,
            v = o.k === j ? tl : tl + TT[o.k][j];
          if (v < t) t = v;
        });
        if (t < 200) u += base[j] * Math.exp(-t / 14);
      }
      const rural = 8 + 25 * clamp((soilVal(wx, wy) - 0.4) * 3, 0, 1);
      a[gy * W + gx] = rural + u * (inPark(wx, wy) ? 0.35 : 1);
    }
  HEAT.land = a;
  HEAT.limg = heatImg(a, W, H, (v) => {
    const t = Math.log10(v / 10) / 3.5,
      r = ramp(LRH, t);
    return [r[0], r[1], r[2], Math.round(255 * (0.55 + 0.4 * clamp(t, 0, 1)))];
  });
  return HEAT.limg;
}
export function drawHeat(ctx, s, img, shift = 0, w = 0, h = 0, OX = 0, OY = 0) {
  const l = Math.max(0, -OX / s - shift),
    r = Math.min(RW, (w - OX) / s - shift),
    t = Math.max(0, -OY / s),
    b = Math.min(RH, (h - OY) / s);
  if (r <= l || b <= t) return;
  ctx.save();
  ctx.fillStyle = rgb(C.paper, 0.35);
  ctx.fillRect(l * s, t * s, (r - l) * s, (b - t) * s);
  ctx.imageSmoothingEnabled = true;
  drawViewportImage(ctx, img, s, shift, w, h, OX, OY);
  ctx.restore();
}
function landCell(c, k, b) {
  const t = c.grid[k];
  if (t === WATER || (c.foreign && c.foreign[k])) return 0;
  const d = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy) * CELLKM,
    lam = Math.max(1.2, 0.55 * (c.brad || 4) * CELLKM);
  let v = b * (0.03 + 0.97 * Math.exp(-d / lam));
  if (c.metro.length) v *= 1 + 0.7 * Math.exp(-c.stD[k] / 4);
  if (c.biz && c.bizD) v *= 1 + 0.5 * Math.exp(-c.bizD[k] / 5);
  if (c.roadD[k] <= 2) v *= 1.12;
  if (t === IND) v *= 0.55;
  else if (t === ABAND) v *= 0.4;
  else if (t === HIST) v *= 1.1;
  else if (t === SKY) v *= 1.25;
  else if (t === EMPTY) v *= c.forest[k] ? 0.2 : 0.3;
  return Math.max(v, 10);
}
export function cityHeat(c, kind) {
  const key =
    kind +
    "|" +
    S.year +
    "|" +
    c.builtCells +
    "|" +
    c.aband +
    "|" +
    stations(c) +
    "|" +
    (c.biz || 0);
  if (c.heat && c.heatKey === key) return c.heat;
  const a = new Float32Array(G * G),
    occ = Math.min(1.06, c.P / Math.max(1, c.H)),
    b = landBase(c);
  for (let k = 0; k < G * G; k++)
    a[k] = kind === "dens" ? (CAP[c.grid[k]] * occ) / (CELLKM * CELLKM) : landCell(c, k, b);
  c.heat = heatImg(
    a,
    G,
    G,
    kind === "dens"
      ? (v) => {
          if (v < 1) return null;
          const r = ramp(DRH, Math.log10(v / 300) / 2.3);
          return [r[0], r[1], r[2], 230];
        }
      : (v) => {
          if (!v) return null;
          const r = ramp(LRH, Math.log10(v / 10) / 3.5);
          return [r[0], r[1], r[2], 215];
        },
  );
  c.heatArr = a;
  c.heatKey = key;
  return c.heat;
}
const KIND_T = [
  "незастроено",
  "ИЖС",
  "5–9 этажей",
  "высотная",
  "пустует",
  "промзона",
  "старый центр",
  "вода",
  "деловой центр",
  "небоскрёбы",
];
function placementSummary(x, y) {
  const sh = areaShares(x, y),
    works = [];
  if (sh.soil > 0.3) works.push("земледелие " + Math.round(sh.soil * 100) + "%");
  if (sh.forest > 0.3) works.push("лес " + Math.round(sh.forest * 100) + "%");
  const deps = S.T.deps
    .filter(
      (d) =>
        (d.used || 0) < 2 &&
        (d.res == null || d.res > 0) &&
        (!S.planet || countryAt(d.x, d.y) === 0) &&
        geoXY(d.x, d.y, x, y) <= (S.planet ? DEPOSIT_REACH : 18),
    )
    .map((d) => d.t);
  const mine = [...new Set(deps)];
  if (mine.length) works.push("добыча: " + mine.join(", "));
  const river = riverPortAccess(x, y),
    sea = seaPortAccess(x, y),
    rd = river.dist,
    sd = sea.dist,
    riverText = river.ok
      ? "доступен · " + fmtN(rd) + " км"
      : rd < 1e8
        ? "нет · река в " + fmtN(rd) + " км"
        : "нет поблизости",
    seaText = sea.ok
      ? "доступен · берег в " + fmtN(sd) + " км"
      : sd >= 0 && sd < 1e8
        ? "нет · берег в " + fmtN(sd) + " км"
        : sd < 0
          ? "нет · точка в море"
          : "нет поблизости";
  return (
    "Доступные отрасли: " +
    (works.join(" · ") || "нет") +
    "\nРечной порт: " +
    riverText +
    "\nМорской порт: " +
    seaText +
    "\nМесторождения: " +
    (mine.length ? mine.join(", ") : "нет в радиусе " + DEPOSIT_REACH + " км")
  );
}
export function showPlacementPreview(e, p) {
  const r = RC.getBoundingClientRect();
  probeAt(e.clientX - r.left, e.clientY - r.top, placementSummary(p.x, p.y));
}
export function probeAt(px, py, txt) {
  const pb = $("#probe");
  if (!txt) {
    pb.hidden = true;
    return;
  }
  pb.textContent = txt;
  pb.hidden = false;
  const vw = $("#view").clientWidth,
    vh = $("#view").clientHeight;
  pb.style.left = Math.max(4, Math.min(px + 14, vw - pb.offsetWidth - 6)) + "px";
  pb.style.top = clamp(py - pb.offsetHeight - 12, 4, Math.max(4, vh - pb.offsetHeight - 4)) + "px";
}
export function probeRegion(e) {
  if (LAYER !== "dens" && LAYER !== "land" && LAYER !== "acc") {
    probeAt(0, 0, "");
    return;
  }
  const m = mapPos(e),
    r = RC.getBoundingClientRect();
  if (m.x < 0 || m.y < 0 || m.x >= RW || m.y >= RH) {
    probeAt(0, 0, "");
    return;
  }
  let t;
  if (LAYER === "acc") {
    accRegion();
    const v = HEAT.acc[Math.floor((m.y / RH) * 180) * 240 + Math.floor((m.x / RW) * 240)];
    t = v >= 0 ? fmtT(v) + " от города " + S.cities[S.sel].name : "море";
  } else if (LAYER === "dens") {
    const s = (r.width / RW) * V.z,
      v =
        s >= DENS_DETAIL_SCALE
          ? densityDetailAt(m.x, m.y)
          : (densRegion(),
            HEAT.dens[Math.floor((m.y / RH) * DENS_H) * DENS_W + Math.floor((m.x / RW) * DENS_W)]);
    t = v < 1 ? "почти никто не живёт" : fmtDens(v);
  } else {
    landRegion();
    t = "земля ≈ " + fmtRub(HEAT.land[Math.floor(m.y / 4) * 160 + Math.floor(m.x / 4)]);
  }
  probeAt(e.clientX - r.left, e.clientY - r.top, t);
}
function gradHtml(st, labels, unit) {
  return (
    '<div class="grad" style="background:linear-gradient(90deg,' +
    st.join(",") +
    ')"></div><div class="gradl">' +
    labels.map((x) => "<span>" + x + "</span>").join("") +
    '</div><p class="note" style="margin-top:4px">' +
    unit +
    "</p>"
  );
}
const LG_BASE =
  '<span><i style="background:var(--c-soil)"></i>чернозём</span><span><i style="background:var(--c-forest)"></i>лес</span><span><i class="rail"></i>железная дорога</span><span><i style="background:var(--c-air);border-radius:50%"></i>аэропорт</span><span><i style="background:var(--ink-soft)"></i>сёла</span><span><i style="background:var(--c-water)"></i>море, озёра</span><span><i style="background:var(--c-rock)"></i>горы</span><span><i style="background:#F2B705"></i>крупная электростанция</span><span><i style="border:1.5px dashed var(--ink);border-radius:50%;background:none"></i>агломерация</span>';
const ROAD_LG =
  '<div class="legend" style="margin-top:5px"><span><i class="ln" style="border-top:4px solid #C7A5FF"></i>международная</span><span><i class="ln" style="border-top:4px solid #74D6F4"></i>национальная</span><span><i class="ln" style="border-top:2.5px solid #F0B761"></i>региональная</span><span><i class="ln" style="border-top:1.5px dashed #AAB8C1"></i>местная</span></div>';
const SPEC_LG = [
  ["s-ind", "промышл."],
  ["s-mine", "сырьевой"],
  ["s-agro", "аграрный"],
  ["s-wood", "лесопром."],
  ["s-it", "научный"],
  ["s-tour", "туристич."],
  ["s-gov", "админ."],
  ["c-izhs", "спальный"],
  ["s-log", "логистич."],
  ["paper-2", "многофункц."],
];
export function drawLegend() {
  const box = $("#legend");
  let h = "";
  if (VIEW === "region") {
    if (LAYER === "growth")
      h =
        '<div class="legend"><span><i style="background:var(--grow)"></i>растёт</span><span><i style="background:var(--decline)"></i>сокращается</span>' +
        (APP_PREFS.resources
          ? '<span><i style="background:var(--s-mine);transform:rotate(45deg) scale(.8)"></i>месторождение</span>'
          : "") +
        LG_BASE +
        "</div>";
    else if (LAYER === "spec")
      h =
        '<div class="legend">' +
        SPEC_LG.map(
          (x) => '<span><i style="background:var(--' + x[0] + ')"></i>' + x[1] + "</span>",
        ).join("") +
        "</div>";
    else if (LAYER === "dens")
      h =
        "<b>Плотность населения</b>" +
        gradHtml(
          DRAMP,
          ["1", "10", "100", "1000", "10 тыс."],
          "Человек на км². На планетарном масштабе растр обобщён, при приближении показываются кварталы 150 × 150 м и сельские поселения.",
        );
    else if (LAYER === "land")
      h =
        "<b>Цена земли</b>" +
        gradHtml(
          LRAMP,
          ["10", "100", "1000", "10 тыс.", "30 тыс."],
          "Рублей за м², ячейка 4 × 4 км. Зависит от размера ближайших городов и времени пути до них, на чернозёме сельхозземля дороже, в нацпарках и заповедниках дешевле.",
        );
    else if (LAYER === "acc")
      h =
        "<b>Время в пути от города " +
        esc(S.cities[S.sel].name) +
        "</b>" +
        gradHtml(
          ARAMP.map((a) => rgb(a)),
          ["0", "1 ч", "2 ч", "3 ч", "4 ч"],
          "Линии проведены через каждые 30 минут. Учтены дороги, железные дороги, местный подъезд и авиарейсы по расписанию. Другой город выбирается щелчком по карте.",
        );
    else if (LAYER === "airlinks")
      h =
        '<b>Плотность авиасвязей</b><div class="legend"><span><i class="ln" style="border-top:2px solid var(--c-air)"></i>меньше пассажиров</span><span><i class="ln" style="border-top:7px solid var(--c-air)"></i>больше пассажиров</span></div><p class="note">Толщина линии учитывает расчётный пассажиропоток за год; расписание задаётся рейсами в месяц. Частота сокращает ожидание, повышает доступную вместимость и улучшает доступность городов.</p>';
    else if (LAYER === "cargo")
      h =
        '<b>Грузовые маршруты</b><div class="legend"><span><i class="ln" style="border-top:4px solid #72D7F4"></i>морской</span><span><i class="ln" style="border-top:4px solid #6CE0B4"></i>речной</span></div><p class="note">Линии проходят по воде. В таблице маршрутов отображаются конкретные товары, объём поставок в тоннах за год и их стоимость.</p>';
    else if (LAYER === "territory")
      h =
        '<b>Территория государства</b><div class="legend"><span><i style="background:#9CA5A0"></i>свободный регион</span><span><i style="background:var(--accent)"></i>регион государства</span><span><i style="background:var(--grow)"></i>граница регионов</span></div><p class="note">Нажмите на регион, чтобы открыть его меню. Свободный регион присоединяется за 50 млрд плюс 1 млрд за каждые начатые 100 км от ближайшего города с населением от 100 тыс.</p>';
    else if (LAYER === "nature")
      h =
        '<b>Природные биомы</b><div class="legend">' +
        BIOMES.slice(1)
          .map((x) => '<span><i style="background:' + x.color + '"></i>' + x.name + "</span>")
          .join("") +
        '</div><p class="note">Биом зависит от широты, осадков, близости океана и высоты рельефа. Горные цепи возникают на сходящихся границах литосферных плит.</p>';
    else
      h =
        '<p class="note">Цвет территории показывает центр, к которому она тянется сильнее всего с учётом дорог. Пунктир соединяет город с центром, которому он подчиняется.</p>';
    if (LAYER === "airlinks" || LAYER === "cargo")
      h +=
        '<p class="note" style="margin-top:6px">Диспетчерский режим: фон карты затемнён, показаны узлы и линии выбранного вида транспорта.</p>';
    else
      h +=
        ROAD_LG +
        '<p class="note" style="margin-top:6px">Планетарный масштаб: столица и города от 3 млн; континентальный: областные центры; региональный: крупные города и области; локальный: все города. Национальные и международные дороги видны издалека, региональные и местные появляются при приближении.</p><p class="note" style="margin-top:6px">Щелчок по городу открывает карточку, двойной щелчок открывает план. Колесо мыши меняет масштаб.</p>';
  } else {
    if (CLAYER === "plan")
      h =
        '<div class="legend"><span><i style="background:var(--c-hist)"></i>старый центр</span><span><i style="background:var(--c-mid)"></i>5–9 этажей</span><span><i style="background:var(--c-high)"></i>высотная</span><span><i style="background:var(--c-sky)"></i>небоскрёбы</span><span><i style="background:var(--c-izhs)"></i>ИЖС</span><span><i style="background:var(--c-ind)"></i>промзона</span><span><i style="background:var(--c-aband)"></i>пустует</span><span><i style="background:var(--c-biz)"></i>деловой центр</span><span><i class="ln" style="border-top:3px solid var(--c-metro)"></i>метро</span><span><i class="ln" style="border-top:4px solid var(--c-air)"></i>аэропорт</span><span><i style="background:var(--c-roadfill);border:2px solid var(--ink)"></i>вокзал</span></div>';
    else if (CLAYER === "dens")
      h =
        "<b>Плотность населения</b>" +
        gradHtml(
          DRAMP,
          ["300", "1000", "3000", "10 тыс.", "60 тыс."],
          "Человек на км² в квартале 150 × 150 м. Наведите курсор на квартал, чтобы увидеть точное значение.",
        );
    else
      h =
        "<b>Цена земли</b>" +
        gradHtml(
          LRAMP,
          ["10", "100", "1000", "10 тыс.", "30 тыс."],
          "Рублей за м². Дороже в центре, у станций метро, у делового центра и вдоль дорог, дешевле в промзонах и на заброшенных участках.",
        );
  }
  if (box.dataset.h !== h) {
    box.innerHTML = h;
    box.dataset.h = h;
  }
  $("#cityScale").hidden = VIEW !== "city";
}

export function setupLayers() {
  CC.addEventListener("mousemove", (e) => {
    if (CLAYER === "plan" || mdraw || bdraw) {
      probeAt(0, 0, "");
      return;
    }
    const c = planCity(),
      p = cityPos(e),
      gx = Math.floor(p.x),
      gy = Math.floor(p.y);
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) {
      probeAt(0, 0, "");
      return;
    }
    const k = gy * G + gx,
      r = CC.getBoundingClientRect();
    if (c.foreign && c.foreign[k]) {
      probeAt(e.clientX - r.left, e.clientY - r.top, "земля соседнего города");
      return;
    }
    cityHeat(c, CLAYER);
    const v = c.heatArr[k];
    probeAt(
      e.clientX - r.left,
      e.clientY - r.top,
      KIND_T[c.grid[k]] +
        " · " +
        (CLAYER === "dens" ? (v ? fmtDens(v) : "жителей нет") : v ? fmtRub(v) : "–"),
    );
  });
  CC.addEventListener("mouseleave", () => probeAt(0, 0, ""));
  RC.addEventListener("mouseleave", () => probeAt(0, 0, ""));
}
