import { ROAD_CLASS_LABELS, selectedRoadClass } from "./actions";
import { planCity } from "./agglomerations";
import { MAXC } from "./config";
import { RC, mapPos, setFounding } from "./controls";
import { DIST, nodeAt } from "./districts";
import { drawBudget, drawCity, drawRegion, render } from "./draw";
import { drawLegend } from "./layers";
import { MCOL, finishMetro, startMetro } from "./metro";
import {
  CLAYER,
  FLOWS,
  HINTMSG,
  LAYER,
  S,
  TAB,
  VIEW,
  ZONE,
  airDraft,
  bdraw,
  bizMsg,
  cargoDraft,
  claimMode,
  cmode,
  dPick,
  founding,
  hintT,
  mdraw,
  pHover,
  placingCapital,
  pmode,
  rdraw,
  rmode,
  setAirDraft,
  setBdraw,
  setCLAYER,
  setCargoDraft,
  setClaimMode,
  setCmode,
  setDPick,
  setFLOWS,
  setHINTMSG,
  setHintT,
  setLAYER,
  setPHover,
  setPmode,
  setRdraw,
  setRmode,
  setTAB,
  setVIEW,
} from "./state";
import { $, fmtPop } from "./util";

export function activeTool() {
  if (founding) return "found";
  if (claimMode) return "claim";
  if (rdraw) return rmode;
  if (airDraft) return "airline";
  if (cargoDraft) return cargoDraft.type === "sea" ? "cargoSea" : "cargoRiver";
  if (pmode) return pmode;
  if (dPick != null) return "dist";
  if (bdraw) return "biz";
  if (mdraw) return "metro";
  return "select";
}
function clearTools() {
  if (founding) setFounding(false);
  setRdraw(null);
  setAirDraft(null);
  setCargoDraft(null);
  setClaimMode(false);
  setPmode(null);
  setPHover(null);
  if (dPick != null) {
    setDPick(null);
    DIST.key = "";
    $("#dbody").dataset.n = "";
  }
  setBdraw(false);
  if (mdraw) finishMetro(true);
}
export function flash(t) {
  setHINTMSG(t);
  clearTimeout(hintT);
  setHintT(
    setTimeout(() => {
      setHINTMSG("");
      toolButtons();
    }, 3500),
  );
  toolButtons();
}
export function nextColor(c) {
  const used = c.metro.map((l) => l.color.toLowerCase()),
    m = MCOL.find((x) => used.indexOf(x[0].toLowerCase()) < 0);
  return m
    ? m[0]
    : "#" +
        Math.floor(Math.random() * 0xffffff)
          .toString(16)
          .padStart(6, "0");
}
export function setTool(t) {
  const cur = activeTool();
  clearTools();
  setHINTMSG("");
  if (t !== cur && t !== "select") {
    if (t === "found") {
      if (S.cities.length >= MAXC) flash("В области уже " + MAXC + " городов");
      else {
        setView("region", true);
        setFounding(true);
      }
    } else if (t === "road" || t === "rail" || t === "up") {
      setView("region", true);
      setRmode(t);
      setRdraw({ from: null, hover: null, msg: "" });
    } else if (t === "np" || t === "zap") {
      setView("region", true);
      setPmode(t);
    } else if (t === "claim") {
      setView("region", true);
      if (!S.planet) flash("Присоединение районов доступно в планетарной партии.");
      else {
        setClaimMode(true);
        setLAYER("territory");
        document
          .querySelectorAll("[data-layer]")
          .forEach((x) =>
            x.setAttribute(
              "aria-pressed",
              (x as HTMLElement).dataset.layer === "territory" ? "true" : "false",
            ),
          );
      }
    } else if (t === "biz") {
      setView("city", true);
      setBdraw(true);
    } else if (t === "airline") {
      setView("region", true);
      setAirDraft({ from: null, hover: null, msg: "" });
    } else if (t === "cargoSea" || t === "cargoRiver") {
      setView("region", true);
      setCargoDraft({ type: t === "cargoSea" ? "sea" : "river", from: null, hover: null, msg: "" });
      setLAYER("cargo");
      document
        .querySelectorAll("[data-layer]")
        .forEach((x) =>
          x.setAttribute(
            "aria-pressed",
            (x as HTMLElement).dataset.layer === "cargo" ? "true" : "false",
          ),
        );
    } else if (t === "metro") {
      const c = planCity();
      if ((c.PA || c.P) < 250000 && !c.metro.length)
        flash(
          "Метро строится в городах и агломерациях от 250 тыс. жителей, в городе " +
            c.name +
            " сейчас " +
            fmtPop(c.PA || c.P),
        );
      else {
        startMetro(c, nextColor(c));
        setTab("city", true);
        return;
      }
    }
  }
  toolButtons();
  render();
}
function hintText(t) {
  if (HINTMSG) return HINTMSG;
  if (t === "found")
    return "Выберите место для нового города. У курсора видны ресурсы и цена. Esc отменяет.";
  if (t === "claim")
    return "Нажмите район: свободный можно включить в государство за 15 млрд + 1 млрд за каждые 10 км от города от 100 тыс.; у своего района выберите регион.";
  if (t === "road")
    return "Выберите два города. Для нового участка задайте класс дороги; повторно выберите следующий класс, чтобы повысить существующий участок.";
  if (t === "road") {
    const cls = selectedRoadClass(),
      desc = {
        local: "дешевле и медленнее",
        regional: "обычная скорость и цена",
        national: "быстрее, дороже и заметнее издалека",
        international: S.ext.length
          ? "для связи с соседним государством"
          : "требует включённых соседних государств",
      }[cls];
    return (
      "Класс: " +
      ROAD_CLASS_LABELS[cls] +
      " — " +
      desc +
      ". Выберите два города; цена участка видна у курсора, содержание будет списываться каждый год. " +
      (cls === "international" && !S.ext.length ? "Соседние государства сейчас отключены. " : "") +
      "Максимальный пролёт моста — 18 км."
    );
  }
  if (t === "rail")
    return "Щёлкайте по городам один за другим, каждый участок строится сразу, цена видна у курсора. Щелчок по пустому месту прерывает цепочку. Максимальный пролёт моста через море — 18 км.";
  if (t === "up")
    return "Щёлкните по двум соседним городам, чтобы сделать дорогу или железную дорогу между ними скоростной.";
  if (t === "np")
    return "Щёлкните по карте, чтобы создать национальный парк радиусом 10 км за 2 млрд.";
  if (t === "zap") return "Щёлкните по карте, чтобы создать заповедник радиусом 12 км за 1 млрд.";
  if (t === "dist")
    return "Новая область получает территорию ближайшего областного центра. Выберите город и создайте вокруг него область. Через «состав» закрепите города вручную: они тоже становятся точками, от которых рассчитывается её территория.";
  if (t === "biz")
    return (
      bizMsg ||
      "Щёлкайте по плану, квартал 450 × 450 м стоит 2 млрд. Рядом с деловым центром охотнее строят высотки."
    );
  if (t === "airline")
    return airDraft && airDraft.msg
      ? airDraft.msg
      : "Спроектируйте маршрут: щёлкните по городу с аэропортом, затем по другому аэропорту. Линия двусторонняя. Частота настраивается в карточке города.";
  if (t === "cargoSea")
    return cargoDraft && cargoDraft.msg
      ? cargoDraft.msg
      : "Морской грузовой маршрут: выберите два города с морскими портами и доступом к морю. Линия обойдёт сушу по океанской сетке.";
  if (t === "cargoRiver")
    return cargoDraft && cargoDraft.msg
      ? cargoDraft.msg
      : "Речной грузовой маршрут: выберите два речных порта на одном русле. Линия пройдёт вдоль реки.";
  if (t === "metro")
    return "Ставьте станции щелчками по плану, 1,5 млрд за каждую. Ctrl+Z отменяет последнюю, щелчок по конечной замыкает кольцо, Esc завершает линию.";
  return "";
}
export function toolButtons() {
  const t = activeTool();
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", (b as HTMLElement).dataset.tool === t ? "true" : "false"),
    );
  $("#roadClassControl").hidden = VIEW !== "region" || t !== "road";
  RC.classList.toggle(
    "drawing",
    !!(rdraw || airDraft || cargoDraft || claimMode || dPick != null || pmode),
  );
  RC.classList.toggle("founding", founding);
  RC.classList.toggle("choosing", placingCapital);
  $("#city").classList.toggle("drawing", !!(mdraw || bdraw));
  const h = $("#hint"),
    txt = hintText(t);
  if (h.textContent !== txt) h.textContent = txt;
  h.hidden = !txt;
  h.classList.toggle("warn", !!(HINTMSG || (t === "biz" && bizMsg)));
}
export function setView(v, quiet?) {
  if (VIEW === v) {
    if (!quiet) render();
    return;
  }
  if (v === "city") {
    if (founding) setFounding(false);
    setRdraw(null);
    setAirDraft(null);
    setCargoDraft(null);
    setClaimMode(false);
    setPmode(null);
    if (dPick != null) {
      setDPick(null);
      DIST.key = "";
    }
  } else {
    setBdraw(false);
    if (mdraw) finishMetro(true);
  }
  setVIEW(v);
  $("#region").hidden = v !== "region";
  $("#resourceOverlay").hidden = v !== "region";
  $("#geoNameOverlay").hidden = v !== "region";
  $("#city").hidden = v !== "city";
  $("#viewR").setAttribute("aria-pressed", v === "region" ? "true" : "false");
  $("#viewC").setAttribute("aria-pressed", v === "city" ? "true" : "false");
  document.querySelectorAll<HTMLElement>("[data-lg]").forEach((el) => {
    el.hidden = el.dataset.lg !== v;
  });
  $("#probe").hidden = true;
  toolButtons();
  if (!quiet) render();
}
export function setTab(t, quiet?) {
  setTAB(t);
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) =>
      b.setAttribute("aria-selected", (b as HTMLElement).dataset.tab === t ? "true" : "false"),
    );
  document.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => {
    p.hidden = p.dataset.pane !== t;
  });
  if (!quiet) render();
}
const budgetDialog = $("#budgetDialog");

export function setupViews() {
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-tool]");
    if (b) setTool((b as HTMLElement).dataset.tool);
  });
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.addEventListener("click", () => setTab((b as HTMLElement).dataset.tab)));
  $("#viewR").addEventListener("click", () => setView("region"));
  $("#viewC").addEventListener("click", () => setView("city"));
  $("#openPlan").addEventListener("click", () => setView("city"));
  document.querySelectorAll<HTMLElement>("[data-layer]").forEach((b) =>
    b.addEventListener("click", () => {
      setLAYER(b.dataset.layer);
      if (LAYER !== "territory") $("#territoryPopup").hidden = true;
      setCmode(LAYER === "spec" ? "spec" : "growth");
      ZONE.show = LAYER === "zones";
      document
        .querySelectorAll("[data-layer]")
        .forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      $("#probe").hidden = true;
      drawLegend();
      drawRegion();
    }),
  );
  $("#roadClassSelect").addEventListener("change", () => {
    toolButtons();
    drawRegion();
  });
  $("#budgetKpi").addEventListener("click", () => {
    drawBudget();
    budgetDialog.showModal();
  });
  $("#budgetClose").addEventListener("click", () => budgetDialog.close());
  budgetDialog.addEventListener("click", (e) => {
    if (e.target === budgetDialog) budgetDialog.close();
  });
  document.querySelectorAll<HTMLElement>("[data-clayer]").forEach((b) =>
    b.addEventListener("click", () => {
      setCLAYER(b.dataset.clayer);
      document
        .querySelectorAll("[data-clayer]")
        .forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      $("#probe").hidden = true;
      drawLegend();
      drawCity();
    }),
  );
  $("#flowChk").addEventListener("change", (e) => {
    setFLOWS(e.target.checked);
    drawRegion();
  });
  $("#lgToggle").addEventListener("click", (e) => {
    const b = $("#legendBox"),
      m = !b.classList.contains("min");
    b.classList.toggle("min", m);
    e.target.textContent = m ? "легенда" : "свернуть";
    e.target.setAttribute("aria-expanded", m ? "false" : "true");
  });
  RC.addEventListener("dblclick", (e) => {
    if (activeTool() !== "select") return;
    const hk = nodeAt(mapPos(e));
    if (typeof hk === "number") {
      S.sel = hk;
      setView("city");
    }
  });
}
