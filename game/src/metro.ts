import { refund, spend } from "./actions";
import { planCity } from "./agglomerations";
import { metroUpdate } from "./city";
import { cityView, rgb } from "./colors";
import { CELLKM, G, WATER } from "./config";
import { setFounding } from "./controls";
import { addVertex, drawEditPoly, drawPolyLabels, drawPolys } from "./districts";
import { drawCity, drawKpis, halo, render } from "./draw";
import { evaluate, logEv } from "./model";
import { placeBiz } from "./saveload";
import {
  C,
  CZ,
  FONT,
  LASTCV,
  S,
  bdraw,
  cMoved,
  cdrag,
  cghost,
  dEdit,
  mdraw,
  setCMoved,
  setCZ,
  setCdrag,
  setCghost,
  setDEdit,
  setLASTCV,
  setMdraw,
} from "./state";
import { $, clamp, esc, fmtPop } from "./util";
import { activeTool, nextColor, setView, toolButtons } from "./views";

export const MCOL = [
  ["#3B3B98", "индиго"],
  ["#6AB04C", "салатовая"],
  ["#E17055", "коралловая"],
  ["#7F8C8D", "серая"],
  ["#D7263D", "красная"],
  ["#1B9E4B", "зелёная"],
  ["#1F6FD1", "синяя"],
  ["#F2A20C", "оранжевая"],
  ["#8E3FB5", "фиолетовая"],
  ["#14A3A8", "бирюзовая"],
  ["#8A5A2B", "коричневая"],
  ["#E8458B", "розовая"],
];
export function drawCityOverlays(ctx, c, s) {
  drawPolys(ctx, c.districts, s);
  c.metro.forEach((l) => {
    if (!l.st.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const pth = () => {
      ctx.beginPath();
      l.st.forEach((p, i) => (i ? ctx.lineTo(p[0] * s, p[1] * s) : ctx.moveTo(p[0] * s, p[1] * s)));
      if (l.ring) ctx.closePath();
      ctx.stroke();
    };
    ctx.strokeStyle = rgb(C.paper, 0.9);
    ctx.lineWidth = Math.max(3, s * 1.0) + 3;
    pth();
    ctx.strokeStyle = l.color;
    ctx.lineWidth = Math.max(3, s * 1.0);
    pth();
    ctx.restore();
  });
  c.metro.forEach((l, i) => {
    if (l.st.length < 2) return;
    const a = l.st[l.st.length - 1],
      b = l.st[l.st.length - 2],
      dx = a[0] - b[0],
      dy = a[1] - b[1],
      L = Math.hypot(dx, dy) || 1;
    ctx.font = "700 12px " + FONT.d;
    ctx.fillStyle = l.color;
    ctx.textAlign = dx >= 0 ? "left" : "right";
    ctx.textBaseline = "middle";
    halo(ctx, lineName(l, i), (a[0] + (dx / L) * 2.2) * s, (a[1] + (dy / L) * 2.2) * s);
  });
  const seen = {};
  c.metro.forEach((l) =>
    l.st.forEach((p) => {
      const k = Math.round(p[0] * 4) + ":" + Math.round(p[1] * 4);
      seen[k] = (seen[k] || 0) + 1;
    }),
  );
  c.metro.forEach((l) =>
    l.st.forEach((p) => {
      const k = Math.round(p[0] * 4) + ":" + Math.round(p[1] * 4),
        tr = seen[k] > 1;
      ctx.fillStyle = rgb(C.paper);
      ctx.strokeStyle = tr ? rgb(C.ink) : l.color;
      ctx.lineWidth = tr ? 2.5 : 2;
      ctx.beginPath();
      ctx.arc(p[0] * s, p[1] * s, Math.max(tr ? 4.5 : 3.5, s * (tr ? 1.5 : 1.15)), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }),
  );
  if (mdraw && cghost && mdraw.city === c.i) {
    const l = c.metro[mdraw.li];
    const sp = snapPoint(c, cghost.x, cghost.y, mdraw.li);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = Math.max(3, s);
    ctx.setLineDash([5, 4]);
    if (l.st.length) {
      const e = nearEnd(l, sp[0], sp[1]);
      ctx.beginPath();
      ctx.moveTo(e[0] * s, e[1] * s);
      ctx.lineTo(sp[0] * s, sp[1] * s);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = rgb(C.paper);
    ctx.beginPath();
    ctx.arc(sp[0] * s, sp[1] * s, Math.max(3.5, s * 1.15), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  drawPolyLabels(ctx, c.districts, s);
  if (dEdit && dEdit.target === "city" && dEdit.city === c.i) drawEditPoly(ctx, dEdit, s);
}
function nearEnd(l, x, y) {
  const a = l.st[0],
    b = l.st[l.st.length - 1];
  return Math.hypot(a[0] - x, a[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? a : b;
}
function snapPoint(c, x, y, li) {
  let best = null;
  c.metro.forEach((l, k) => {
    if (k === li) return;
    l.st.forEach((p) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < 2.5 && (!best || d < best.d)) best = { d, p };
    });
  });
  return best ? [best.p[0], best.p[1]] : [x, y];
}
export function startMetro(c, color) {
  if (dEdit) {
    setDEdit(null);
  }
  setView("city", true);
  setFounding(false);
  c.metro.push({ color, st: [], name: "Линия " + (c.metro.length + 1) });
  setMdraw({ city: c.i, li: c.metro.length - 1, isNew: true, added: 0, msg: "" });
  toolButtons();
  render();
}
function contMetro(c, li) {
  if (dEdit) setDEdit(null);
  setView("city", true);
  setFounding(false);
  setMdraw({ city: c.i, li, isNew: false, added: 0, msg: "" });
  toolButtons();
  render();
}
function addStation(c, x, y) {
  const l = c.metro[mdraw.li];
  if (x < 0 || y < 0 || x >= G || y >= G) return;
  if (!l.ring && l.st.length >= 3) {
    const a = l.st[0],
      b = l.st[l.st.length - 1];
    if (Math.hypot(a[0] - x, a[1] - y) < 2.5 || Math.hypot(b[0] - x, b[1] - y) < 2.5) {
      l.ring = true;
      mdraw.added++;
      (mdraw.stack = mdraw.stack || []).push({ t: "ring" });
      mdraw.msg = "";
      metroUpdate(c);
      evaluate();
      drawCity();
      drawMetroBox(c);
      return;
    }
  }
  const [sx, sy] = snapPoint(c, x, y, mdraw.li);
  if (c.grid[Math.floor(sy) * G + Math.floor(sx)] === WATER) {
    mdraw.msg = "На воде станцию не поставить.";
    drawMetroBox(c);
    return;
  }
  if (l.st.some((p) => Math.hypot(p[0] - sx, p[1] - sy) < 4)) {
    mdraw.msg = "Слишком близко к соседней станции этой линии, нужно не меньше 600 м.";
    drawMetroBox(c);
    return;
  }
  if (!spend(1.5, "metro")) {
    mdraw.msg = "Не хватает денег, станция стоит 1,5 млрд.";
    drawMetroBox(c);
    return;
  }
  if (l.ring) {
    let bi = 0,
      bc = 1e9;
    for (let i = 0; i < l.st.length; i++) {
      const p = l.st[i],
        q = l.st[(i + 1) % l.st.length],
        cst =
          Math.hypot(p[0] - sx, p[1] - sy) +
          Math.hypot(q[0] - sx, q[1] - sy) -
          Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (cst < bc) {
        bc = cst;
        bi = i;
      }
    }
    l.st.splice(bi + 1, 0, [sx, sy]);
  } else if (l.st.length >= 2 && nearEnd(l, sx, sy) === l.st[0]) l.st.unshift([sx, sy]);
  else l.st.push([sx, sy]);
  (mdraw.stack = mdraw.stack || []).push({ t: "add", p: [sx, sy] });
  mdraw.added++;
  mdraw.msg = "";
  metroUpdate(c);
  evaluate();
  drawCity();
  drawKpis();
  drawMetroBox(c);
}
export function undoStation(c) {
  if (!mdraw || !mdraw.stack || !mdraw.stack.length) return;
  const l = c.metro[mdraw.li],
    a = mdraw.stack.pop();
  if (a.t === "ring") l.ring = false;
  else {
    const i = l.st.findIndex((p) => p[0] === a.p[0] && p[1] === a.p[1]);
    if (i >= 0) l.st.splice(i, 1);
    refund(1.5, "metro");
  }
  mdraw.added = Math.max(0, mdraw.added - 1);
  mdraw.msg = "";
  metroUpdate(c);
  evaluate();
  drawCity();
  drawKpis();
  drawMetroBox(c);
}
export function finishMetro(silent?) {
  if (!mdraw) return;
  const c = S.cities[mdraw.city],
    l = c.metro[mdraw.li];
  const name = l ? "«" + (l.name || "Линия " + (mdraw.li + 1)) + "»" : "";
  if (l && l.st.length < 2) {
    refund(1.5 * l.st.length, "metro");
    c.metro.splice(mdraw.li, 1);
  } else if (l && mdraw.added && !silent)
    logEv(
      "Город " +
        c.name +
        ": " +
        (mdraw.isNew
          ? "открыта линия метро " + name + ", станций " + l.st.length
          : "линия метро " + name + " продлена, станций " + l.st.length),
    );
  else if (l && mdraw.added)
    logEv("Город " + c.name + ": линия метро " + name + ", станций " + l.st.length);
  setMdraw(null);
  setCghost(null);
  metroUpdate(c);
  evaluate();
  toolButtons();
  if (!silent) render();
}
function lineName(l, i) {
  return l.name || "Линия " + (i + 1);
}
export function drawMetroBox(c) {
  const box = $("#metroBox");
  let sig, html;
  if (mdraw && mdraw.city === c.i) {
    const l = c.metro[mdraw.li];
    sig =
      "d|" +
      c.i +
      "|" +
      mdraw.li +
      "|" +
      l.st.length +
      "|" +
      mdraw.msg +
      "|" +
      !!l.ring +
      "|" +
      (mdraw.stack || []).length;
    html =
      '<p class="note">Щёлкайте по плану города, чтобы ставить станции, 1,5 млрд за каждую. «Отменить станцию» или Ctrl+Z убирает последнюю и возвращает деньги. Новая станция пристраивается к ближайшему концу линии, а щелчок по конечной станции этой же линии замыкает её в кольцо. В кольцо новые станции встраиваются в ближайший перегон. Если поставить её рядом со станцией другой линии, получится пересадка.</p>' +
      '<div class="mrow"><span class="sw" style="background:' +
      l.color +
      '"></span><b>' +
      esc(lineName(l, mdraw.li)) +
      "</b><span>станций " +
      l.st.length +
      (l.ring ? ", кольцо" : "") +
      '</span><button type="button" data-mundo="1"' +
      (mdraw.stack && mdraw.stack.length ? "" : " disabled") +
      '>Отменить станцию</button><button type="button" data-mdone="1">Готово</button></div>' +
      (mdraw.msg ? '<p class="note" style="color:var(--bad)">' + mdraw.msg + "</p>" : "");
  } else if ((c.PA || c.P) < 250000 && !c.metro.length) {
    sig = "n|" + c.i + "|" + fmtPop(c.PA || c.P);
    html =
      '<p class="note">Метро можно строить в городах и агломерациях от 250 тыс. жителей, сейчас ' +
      fmtPop(c.PA || c.P) +
      ".</p>";
  } else {
    const used = c.metro.map((l) => l.color);
    sig =
      "l|" +
      c.i +
      "|" +
      c.metro.map((l) => l.st.length).join(",") +
      "|" +
      ((c.PA || c.P) >= 250000) +
      "|" +
      Math.round(c.metroCov * 100);
    const rows = c.metro
      .map(
        (l, i) =>
          '<div class="mrow"><input type="color" class="lcol" data-lc="' +
          i +
          '" value="' +
          l.color +
          '" aria-label="Цвет линии"><input type="text" class="lname" data-li="' +
          i +
          '" maxlength="32" aria-label="Название линии" style="flex:1 1 8em;min-width:6em"><span>станций ' +
          l.st.length +
          '</span><button type="button" data-mcont="' +
          i +
          '">Продолжить</button></div>',
      )
      .join("");
    const nextC = nextColor(c),
      sw =
        MCOL.map(
          (m) =>
            '<button type="button" class="swbtn" data-mnew="' +
            m[0] +
            '" style="background:' +
            m[0] +
            '" aria-label="Новая ' +
            m[1] +
            ' линия" title="' +
            m[1] +
            '"></button>',
        ).join("") +
        '<input type="color" id="mColor" value="' +
        nextC +
        '" aria-label="Свой цвет линии"><button type="button" data-mnewc="1">Своим цветом</button>';
    html =
      (c.sats && c.sats.length
        ? '<p class="note">Метро агломерации «' +
          esc(c.name) +
          "»: линии можно вести в города-спутники (" +
          c.sats.map((i) => esc(S.cities[i].name)).join(", ") +
          "), станции там сокращают время поездок в центр.</p>"
        : "") +
      rows +
      ((c.PA || c.P) >= 250000 && sw
        ? '<div class="mrow"><span>Новая линия, выберите цвет</span>' + sw + "</div>"
        : "") +
      (c.metro.length
        ? '<p class="note">Охват застройки станциями в радиусе 900 м: ' +
          Math.round(c.metroCov * 100) +
          "%. Поездки внутри города быстрее на " +
          Math.round(c.metroCov * 35) +
          "%. Название и цвет линии можно поменять прямо в строке.</p>"
        : "");
  }
  if (
    box.dataset.sig !== sig &&
    !(
      document.activeElement &&
      (document.activeElement.classList.contains("lname") ||
        document.activeElement.classList.contains("lcol")) &&
      box.contains(document.activeElement)
    )
  ) {
    box.innerHTML = html;
    box.dataset.sig = sig;
  }
  box.querySelectorAll("input.lname").forEach((inp) => {
    const l = c.metro[+inp.dataset.li];
    if (l && document.activeElement !== inp) inp.value = lineName(l, +inp.dataset.li);
  });
}
export const CC = $("#city");
export function cityPos(e) {
  const r = CC.getBoundingClientRect();
  return {
    x: LASTCV.x0 + (e.clientX - r.left) / LASTCV.s,
    y: LASTCV.y0 + (e.clientY - r.top) / LASTCV.s,
  };
}
export function cityFrame(c, w, h) {
  if (CZ.city !== c.i) setCZ({ z: 1, px: 0, py: 0, city: c.i });
  const base = cityView(c).size,
    size = Math.max(12, base / CZ.z),
    hs = (size * h) / w;
  let x0 = c.cx + CZ.px - size / 2,
    y0 = c.cy + CZ.py - hs / 2;
  x0 = size >= G ? (G - size) / 2 : clamp(x0, 0, G - size);
  y0 = hs >= G ? (G - hs) / 2 : clamp(y0, 0, G - hs);
  CZ.px = x0 + size / 2 - c.cx;
  CZ.py = y0 + hs / 2 - c.cy;
  setLASTCV({ x0, y0, size, s: w / size });
  return LASTCV;
}
export function cityAspect(cv) {
  const p = cv.parentElement;
  return clamp(p.clientHeight / Math.max(1, p.clientWidth), 0.15, 4);
}
function cityZoom(f, mx?, my?) {
  const c = planCity(),
    r = CC.getBoundingClientRect();
  if (mx == null) {
    mx = r.width / 2;
    my = r.height / 2;
  }
  const wx = LASTCV.x0 + mx / LASTCV.s,
    wy = LASTCV.y0 + my / LASTCV.s;
  CZ.z = clamp(CZ.z * f, 1, 8);
  const base = cityView(c).size,
    size = Math.max(12, base / CZ.z),
    s2 = r.width / size,
    hs = (size * r.height) / r.width;
  CZ.px = wx - mx / s2 + size / 2 - c.cx;
  CZ.py = wy - my / s2 + hs / 2 - c.cy;
  drawCity();
}

export function setupMetro() {
  $("#metroBox").addEventListener("input", (e) => {
    const lc = e.target.dataset.lc;
    if (lc != null) {
      const l = planCity().metro[+lc];
      if (l) {
        l.color = e.target.value;
        drawCity();
      }
      return;
    }
    const i = e.target.dataset.li;
    if (i == null) return;
    const l = planCity().metro[+i];
    if (l) {
      l.name = e.target.value;
      drawCity();
    }
  });
  $("#metroBox").addEventListener("click", (e) => {
    const c = planCity();
    const nc0 = e.target.closest("[data-mnewc]");
    if (nc0) {
      startMetro(c, $("#mColor").value);
      return;
    }
    const u0 = e.target.closest("[data-mundo]");
    if (u0) {
      undoStation(c);
      return;
    }
    const n = e.target.closest("[data-mnew]"),
      k = e.target.closest("[data-mcont]"),
      d = e.target.closest("[data-mdone]");
    if (n) startMetro(c, n.dataset.mnew);
    else if (k) contMetro(c, +k.dataset.mcont);
    else if (d) finishMetro();
  });
  CC.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = CC.getBoundingClientRect();
      cityZoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  CC.addEventListener("pointerdown", (e) => {
    setCdrag({ x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    setCMoved(false);
  });
  window.addEventListener("pointerup", () => {
    setCdrag(null);
  });
  CC.addEventListener("pointermove", (e) => {
    if (!cdrag) return;
    if (!cMoved && Math.hypot(e.clientX - cdrag.sx, e.clientY - cdrag.sy) < 6) return;
    setCMoved(true);
    CZ.px -= (e.clientX - cdrag.x) / LASTCV.s;
    CZ.py -= (e.clientY - cdrag.y) / LASTCV.s;
    cdrag.x = e.clientX;
    cdrag.y = e.clientY;
    drawCity();
  });
  $("#czIn").addEventListener("click", () => cityZoom(1.5));
  $("#czOut").addEventListener("click", () => cityZoom(1 / 1.5));
  CC.addEventListener("click", (e) => {
    if (cMoved) {
      setCMoved(false);
      return;
    }
    const c = planCity(),
      p = cityPos(e);
    if (bdraw) {
      placeBiz(c, p);
      return;
    }
    if (mdraw && mdraw.city === c.i) {
      addStation(c, p.x, p.y);
      return;
    }
    if (dEdit && dEdit.target === "city") {
      addVertex(p, 10 / (CC.getBoundingClientRect().width / G));
      toolButtons();
      return;
    }
    if (activeTool() === "select") {
      const wx = c.x + (p.x - c.cx) * CELLKM,
        wy = c.y + (p.y - c.cy) * CELLKM;
      let b = c.i,
        bd = Math.hypot(wx - c.x, wy - c.y);
      (c.sats || []).forEach((i) => {
        const o = S.cities[i],
          v = Math.hypot(wx - o.x, wy - o.y);
        if (v < bd) {
          bd = v;
          b = i;
        }
      });
      if (b !== S.sel) {
        S.sel = b;
        render();
      }
    }
  });
  CC.addEventListener("mousemove", (e) => {
    if (mdraw) {
      setCghost(cityPos(e));
      drawCity();
    } else if (dEdit && dEdit.target === "city") {
      dEdit.hover = cityPos(e);
      drawCity();
    }
  });
  CC.addEventListener("mouseleave", () => {
    setCghost(null);
    if (dEdit) dEdit.hover = null;
    if (mdraw || dEdit) drawCity();
  });
}
