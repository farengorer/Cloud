import { canFound, doAct, found, foundCost, spend } from "./actions";
import { closeMax } from "./app";
import { P, PDEF, RH, RW } from "./config";
import {
  addVertex,
  airlineClick,
  cargoRouteClick,
  districtAt,
  MIN_START_LAND_KM2,
  landComponentArea,
  endPick,
  nodeAt,
  openDistrictPopup,
  pickClick,
  roadClick,
} from "./districts";
import { V, drawRegion, render, updateGameDate, zoomAt } from "./draw";
import { probeAt, probeRegion, showPlacementPreview } from "./layers";
import { finishMetro, undoStation } from "./metro";
import {
  AIR_MAX_FREQ,
  airFreqCost,
  evaluate,
  flightsPerMonth,
  init,
  logEv,
  stepYear,
  wrapX,
} from "./model";
import { S_SOLO, mpLeave, mpPush, mpReady, onRender } from "./multiplayer";
import { loadSave, placePark, saveGame } from "./saveload";
import {
  APP_PREFS,
  DB,
  LAYER,
  MP,
  S,
  TAB,
  airDraft,
  assignFounding,
  bdraw,
  cargoDraft,
  claimMode,
  dEdit,
  dPick,
  dragMoved,
  founding,
  ghost,
  hasActiveGame,
  lastT,
  mdraw,
  musicPlaying,
  onMsg,
  pHover,
  pendingStart,
  pinch0,
  placingCapital,
  playing,
  pmode,
  rdraw,
  renaming,
  roadSel,
  setAPP_PREFS,
  setAirDraft,
  setBdraw,
  setCargoDraft,
  setDEdit,
  setDPick,
  setDragMoved,
  setGhost,
  setHasActiveGame,
  setLastT,
  setMdraw,
  setMusicPlaying,
  setPHover,
  setPendingStart,
  setPinch0,
  setPlacingCapital,
  setPlaying,
  setPmode,
  setRdraw,
  setRenaming,
  setRoadSel,
  setYps,
  yps,
} from "./state";
import { cultureById, riverDist } from "./terrain";
import { $, clamp } from "./util";
import { flash, setTab, setView, toolButtons } from "./views";
import { isIceAt, mtVal, seaD } from "./worldgen";

const sl = $("#sliders");
const APP_PREFS_KEY = "verkhnedonsk-app-preferences";
const bgMusic = $("#bgMusic"),
  musicToggle = $("#musicToggle");
function syncMusicToggle() {
  musicToggle.textContent = musicPlaying ? "♫ Музыка: вкл" : "♫ Музыка: выкл";
  musicToggle.setAttribute("aria-pressed", musicPlaying ? "true" : "false");
  musicToggle.title = musicPlaying ? "Выключить фоновую музыку" : "Включить фоновую музыку";
}
async function toggleMusic() {
  if (musicPlaying) {
    bgMusic.pause();
    setMusicPlaying(false);
    syncMusicToggle();
    return;
  }
  bgMusic.volume = APP_PREFS.musicVolume;
  try {
    await bgMusic.play();
    setMusicPlaying(true);
    syncMusicToggle();
  } catch (e) {
    setMusicPlaying(false);
    syncMusicToggle();
    musicToggle.title = "Не удалось открыть файл музыки. Проверьте папку music рядом с index.html.";
  }
}
function saveMusicVolume() {
  APP_PREFS.musicVolume = clamp((+$("#appMusicVolume").value || 0) / 100, 0, 1);
  bgMusic.volume = APP_PREFS.musicVolume;
  $("#appMusicVolumeValue").textContent = Math.round(APP_PREFS.musicVolume * 100) + "%";
  try {
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify(APP_PREFS));
  } catch (e) {}
}
function showMenuPage(page) {
  const pages = {
    home: "menuHome",
    new: "menuNewGame",
    settings: "menuSettingsPage",
    exit: "menuExitPage",
  };
  Object.keys(pages).forEach((k) => ($("#" + pages[k]).hidden = k !== page));
  $("#menuContinue").hidden = !hasActiveGame;
  $("#stH").textContent = page === "new" ? "Новая игра" : "Симулятор государства";
  $("#menuMessage").textContent = "";
  refreshSaveStatus();
}
function startCityProblem(x, y) {
  if ((!S.planet && (x < 5 || x > RW - 5)) || y < 5 || y > RH - 5)
    return "Выбери место подальше от края карты.";
  if (S.T.sea && seaD(x, y) < 1) return "Город нельзя основать в море.";
  if (S.planet && isIceAt(x, y)) return "Город нельзя основать в полярных льдах.";
  if (S.planet) {
    const id = districtAt(x, y);
    if (id < 0) return "Выбери устойчивый участок суши.";
    if (landComponentArea(id) < MIN_START_LAND_KM2)
      return "Для стартового региона выбери материк или остров площадью не менее 30 тыс. км².";
  }
  if (S.T.ridge && mtVal(x, y) > 0.55) return "Выбери место вне высоких гор.";
  if (riverDist(x, y) < 0.5) return "Город нельзя поставить на реке.";
  return "";
}
function finishStartPlacement(x, y) {
  if (!pendingStart) return;
  const pos = x == null ? { x: S.cities[0].x, y: S.cities[0].y } : { x, y },
    problem = x == null ? "" : startCityProblem(pos.x, pos.y);
  if (problem) {
    $("#startCityStatus").textContent = problem;
    $("#startCityStatus").classList.add("error");
    setGhost(pos);
    drawRegion();
    return;
  }
  const p = pendingStart;
  if (x != null)
    init(p.seed, {
      regionName: p.regionName,
      capName: p.capName,
      cultureId: p.cultureId,
      capX: pos.x,
      capY: pos.y,
      planet: p.planet,
      continentCount: p.continentCount,
      continentNameStyle: p.continentNameStyle,
      foreignCount: p.foreignCount,
    });
  setPendingStart(null);
  setPlacingCapital(false);
  setGhost(null);
  V.z = 1.6;
  V.cx = pos.x;
  V.cy = pos.y;
  setHasActiveGame(true);
  $("#startCityPicker").hidden = true;
  $("#play").disabled = false;
  $("#step").disabled = false;
  $("#menuOpen").disabled = false;
  $("#startCityStatus").textContent = "";
  render();
  if (APP_PREFS.autosave) saveGame("solo").then(refreshSaveStatus);
}
export function refreshSaveStatus() {
  let m = null;
  try {
    const raw = localStorage.getItem("verkhnedonsk-save-solo");
    if (raw) m = JSON.parse(raw).meta;
  } catch (e) {}
  if (!m && typeof S_SOLO !== "undefined" && S_SOLO.save) m = S_SOLO.save;
  const b = $("#menuLoad");
  b.disabled = !m;
  $("#saveStatus").textContent = m
    ? "Последнее сохранение · " +
      (m.regionName || "Верхнедонская область") +
      " · " +
      (m.year || "год неизвестен")
    : "Сохранений пока нет";
}
function setGameSpeed(v, persist) {
  setYps(+v || 1);
  APP_PREFS.speed = yps;
  $("#appSpeed").value = String(yps);
  document
    .querySelectorAll("[data-yps]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", +(b as HTMLElement).dataset.yps === yps ? "true" : "false"),
    );
  if (persist)
    try {
      localStorage.setItem(APP_PREFS_KEY, JSON.stringify(APP_PREFS));
    } catch (e) {}
}
export function storeAppPrefs() {
  APP_PREFS.theme = $("#appTheme").value;
  APP_PREFS.speed = +$("#appSpeed").value || 1;
  APP_PREFS.autosave = $("#appAutosave").checked;
  APP_PREFS.foreignStates = 0;
  APP_PREFS.geoNames = $("#geoNamesChk").checked;
  APP_PREFS.resources = $("#resourcesChk").checked;
  APP_PREFS.relief = $("#appRelief").checked;
  APP_PREFS.musicVolume = clamp((+$("#appMusicVolume").value || 0) / 100, 0, 1);
  setGameSpeed(APP_PREFS.speed, false);
  bgMusic.volume = APP_PREFS.musicVolume;
  $("#appMusicVolumeValue").textContent = Math.round(APP_PREFS.musicVolume * 100) + "%";
  try {
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify(APP_PREFS));
  } catch (e) {}
  if (APP_PREFS.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", APP_PREFS.theme);
}
export function loadAppPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || "{}");
    setAPP_PREFS(Object.assign(APP_PREFS, p));
  } catch (e) {}
  let speed = +APP_PREFS.speed;
  if (speed === 10 || speed === 3) speed = 1;
  const supported = [1 / 36, 1 / 24, 1 / 12, 1 / 4, 1];
  APP_PREFS.speed = supported.find((v) => Math.abs(v - speed) < 1e-8) || 1 / 12;
  APP_PREFS.musicVolume = Number.isFinite(+APP_PREFS.musicVolume)
    ? clamp(+APP_PREFS.musicVolume, 0, 1)
    : 0.35;
  APP_PREFS.foreignStates = 0;
  $("#appTheme").value = ["system", "light", "dark"].includes(APP_PREFS.theme)
    ? APP_PREFS.theme
    : "system";
  $("#appSpeed").value = String(APP_PREFS.speed);
  $("#appMusicVolume").value = String(Math.round(APP_PREFS.musicVolume * 100));
  $("#appAutosave").checked = APP_PREFS.autosave !== false;
  $("#appRelief").checked = APP_PREFS.relief !== false;
  $("#geoNamesChk").checked = APP_PREFS.geoNames !== false;
  $("#resourcesChk").checked = APP_PREFS.resources !== false;
  storeAppPrefs();
}
export function setPlay(v) {
  if (placingCapital && v) return;
  setPlaying(v);
  $("#play").textContent = v ? "Пауза" : "Запустить";
  setLastT(performance.now());
  updateGameDate();
  if (MP) {
    MP.auto = v;
    if (v && !MP.myReady) mpPush(true);
    onRender();
  }
}
export function setFounding(v) {
  assignFounding(v);
  setGhost(null);
  probeAt(0, 0, "");
  if (S) {
    toolButtons();
    drawRegion();
  }
}
export function mapPos(e) {
  const cv = $("#region"),
    r = cv.getBoundingClientRect(),
    s = (r.width / RW) * V.z,
    OX = r.width / 2 - V.cx * s,
    OY = r.height / 2 - V.cy * s;
  return {
    x: S.planet ? wrapX((e.clientX - r.left - OX) / s) : (e.clientX - r.left - OX) / s,
    y: (e.clientY - r.top - OY) / s,
  };
}
function startRename() {
  if (renaming) return;
  setRenaming(true);
  const c = S.cities[S.sel];
  const tb = $("#titlebox");
  tb.innerHTML =
    '<input type="text" id="renameIn" maxlength="28" aria-label="Новое название"><button type="button" id="renameOk">Сохранить</button><button class="link" type="button" id="renameNo">отмена</button>';
  const inp = $("#renameIn");
  inp.value = c.name;
  inp.focus();
  inp.select();
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") stopRename(true);
    if (e.key === "Escape") stopRename(false);
  });
  $("#renameOk").addEventListener("click", () => stopRename(true));
  $("#renameNo").addEventListener("click", () => stopRename(false));
}
function stopRename(save) {
  if (!renaming) return;
  const c = S.cities[S.sel],
    inp = $("#renameIn");
  if (save && inp) {
    const v = inp.value.trim();
    if (v && v !== c.name) {
      logEv("Город " + c.name + " переименован в " + v);
      c.name = v;
    }
  }
  setRenaming(false);
  $("#titlebox").innerHTML =
    '<h2 id="hCity"></h2><button class="link" id="renameBtn" type="button">переименовать</button>';
  $("#renameBtn").addEventListener("click", startRename);
  render();
}
export const RC = $("#region"),
  ptrs = new Map();
function endPtr(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) setPinch0(null);
}
function zoomBtn(f) {
  const r = RC.getBoundingClientRect();
  zoomAt(f, r.width / 2, r.height / 2);
}

export function setupControls() {
  PDEF.forEach((d) => {
    const el = document.createElement("div");
    el.className = "param";
    el.dataset.param = d.id;
    el.innerHTML =
      '<div class="row"><label for="p_' +
      d.id +
      '">' +
      d.label +
      '</label><output id="o_' +
      d.id +
      '">' +
      d.fmt(d.val) +
      '</output></div><input type="range" id="p_' +
      d.id +
      '" min="' +
      d.min +
      '" max="' +
      d.max +
      '" step="' +
      d.step +
      '" value="' +
      d.val +
      '"><small>' +
      d.hint +
      "</small>";
    sl.appendChild(el);
    const inp = el.querySelector("input");
    inp.addEventListener("input", () => {
      P[d.id] = parseFloat(inp.value);
      el.querySelector("output").textContent = d.fmt(P[d.id]);
      evaluate();
      render();
    });
  });
  $("#forest").addEventListener("change", (e) => {
    P.forest = e.target.checked;
  });
  $("#menuOpen").addEventListener("click", async () => {
    if (placingCapital) return;
    setPlay(false);
    if (APP_PREFS.autosave) await saveGame("solo");
    $("#startPanel").hidden = false;
    showMenuPage("home");
  });
  $("#menuContinue").addEventListener("click", () => {
    $("#startPanel").hidden = true;
    render();
  });
  $("#startCitySuggested").addEventListener("click", () => finishStartPlacement(null, null));
  $("#play").addEventListener("click", () => setPlay(!playing));
  $("#step").addEventListener("click", () => {
    if (MP) {
      mpReady();
      return;
    }
    stepYear();
    render();
    if (S.year % 100 === 0 && !DB && APP_PREFS.autosave) saveGame("solo").then(refreshSaveStatus);
  });
  document
    .querySelectorAll("[data-yps]")
    .forEach((b) =>
      b.addEventListener("click", () => setGameSpeed((b as HTMLElement).dataset.yps, true)),
    );
  musicToggle.addEventListener("click", toggleMusic);
  $("#appMusicVolume").addEventListener("input", saveMusicVolume);
  $("#reset").addEventListener("click", () => {
    setPlay(false);
    $("#startPanel").hidden = false;
    showMenuPage("new");
    $("#stRegion").focus();
  });
  $("#menuNew").addEventListener("click", () => {
    showMenuPage("new");
    $("#stRegion").focus();
  });
  $("#menuSettings").addEventListener("click", () => showMenuPage("settings"));
  $("#menuLoad").addEventListener("click", async () => {
    setPlay(false);
    $("#menuMessage").textContent = "Загружаю сохранение…";
    const ok = await loadSave("solo");
    if (ok) {
      setHasActiveGame(true);
      $("#startPanel").hidden = true;
      $("#menuMessage").textContent = "";
      render();
    } else {
      $("#menuMessage").textContent = onMsg || "Сохранение не найдено или повреждено.";
    }
    refreshSaveStatus();
  });
  $("#stCulture").addEventListener("change", () => {
    $("#stCity").value = cultureById($("#stCulture").value).capital;
  });
  $("#stGo").addEventListener("click", () => {
    const rn = $("#stRegion").value.trim() || "Новая область",
      cn = $("#stCity").value.trim() || "Первый город",
      seed = (Math.random() * 1e9) | 0;
    setPlay(false);
    if (MP) mpLeave(true);
    setFounding(false);
    stopRename(false);
    const cultureId = $("#stCulture").value,
      continentNameStyle = $("#stContinentNames").value;
    setMdraw(null);
    setDEdit(null);
    setRdraw(null);
    setDPick(null);
    setPmode(null);
    setBdraw(false);
    V.z = 1;
    V.cx = RW / 2;
    V.cy = RH / 2;
    setView("region", true);
    toolButtons();
    init(seed, {
      regionName: rn,
      capName: cn,
      cultureId,
      planet: true,
      continentCount: +$("#stContinents").value || 5,
      continentNameStyle,
      foreignCount: APP_PREFS.foreignStates,
    });
    setPendingStart({
      seed,
      regionName: rn,
      capName: cn,
      cultureId,
      planet: true,
      continentCount: +$("#stContinents").value || 5,
      continentNameStyle,
      foreignCount: APP_PREFS.foreignStates,
    });
    setPlacingCapital(true);
    setGhost(null);
    setHasActiveGame(false);
    toolButtons();
    $("#play").disabled = true;
    $("#step").disabled = true;
    $("#menuOpen").disabled = true;
    $("#startCityStatus").textContent = "";
    $("#startCityPicker").hidden = false;
    $("#startPanel").hidden = true;
    render();
  });
  $("#stCancel").addEventListener("click", () => showMenuPage("home"));
  $("#settingsBack").addEventListener("click", () => {
    storeAppPrefs();
    showMenuPage("home");
  });
  $("#appTheme").addEventListener("change", storeAppPrefs);
  $("#appSpeed").addEventListener("change", storeAppPrefs);
  $("#appAutosave").addEventListener("change", storeAppPrefs);
  $("#appRelief").addEventListener("change", () => {
    storeAppPrefs();
    if (S) render();
  });
  $("#menuExit").addEventListener("click", async () => {
    setPlay(false);
    if (S && !MP) await saveGame("solo");
    refreshSaveStatus();
    showMenuPage("exit");
    $("#exitMessage").textContent = "Сохранение завершено. Закройте окно приложения, чтобы выйти.";
  });
  $("#exitClose").addEventListener("click", () => {
    if ((window as any).desktopApp) {
      (window as any).desktopApp.exit();
      return;
    }
    window.close();
    $("#exitMessage").textContent =
      "Браузер не разрешил закрыть это окно автоматически. Закройте окно приложения обычным способом.";
  });
  $("#exitBack").addEventListener("click", () => showMenuPage("home"));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && mdraw) {
      e.preventDefault();
      undoStation(S.cities[mdraw.city]);
      return;
    }
    if (e.key !== "Escape") return;
    if (document.querySelector(".panel.max")) {
      closeMax();
    }
    if (bdraw) {
      setBdraw(false);
      toolButtons();
    }
    if (pmode) {
      setPmode(null);
      toolButtons();
      drawRegion();
    }
    if (airDraft || cargoDraft) {
      setAirDraft(null);
      setCargoDraft(null);
      toolButtons();
      drawRegion();
    }
    if (founding) setFounding(false);
    if (mdraw) finishMetro();
    if (rdraw) {
      setRdraw(null);
      toolButtons();
      drawRegion();
    }
    if (dPick != null) endPick();
  });
  $("#region").addEventListener("mouseleave", () => {
    probeAt(0, 0, "");
    if (founding) {
      setGhost(null);
      drawRegion();
    }
  });
  $("#region").addEventListener("click", (e) => {
    if (dragMoved) {
      setDragMoved(false);
      return;
    }
    const m = mapPos(e);
    if (placingCapital) {
      finishStartPlacement(m.x, m.y);
      return;
    }
    if (claimMode) {
      openDistrictPopup(m.x, m.y, e);
      return;
    }
    if (pmode) {
      placePark(m);
      return;
    }
    if (cargoDraft) {
      cargoRouteClick(m);
      return;
    }
    if (airDraft) {
      airlineClick(m);
      return;
    }
    if (rdraw) {
      roadClick(m);
      return;
    }
    if (dPick != null) {
      pickClick(m);
      return;
    }
    if (S.planet && LAYER === "territory") {
      openDistrictPopup(m.x, m.y, e);
      return;
    }
    $("#territoryPopup").hidden = true;
    if (dEdit && dEdit.target === "region") {
      const r = RC.getBoundingClientRect();
      addVertex(m, 10 / ((r.width / RW) * V.z));
      return;
    }
    if (founding) {
      setGhost(m);
      const why = canFound(m.x, m.y),
        fc = foundCost(m.x, m.y);
      if (!why && S.budget >= fc.cost) {
        found(m.x, m.y);
        setFounding(false);
        render();
      } else drawRegion();
      return;
    }
    const hk = nodeAt(m);
    if (typeof hk === "number") {
      stopRename(false);
      S.sel = hk;
      if (TAB !== "nb") setTab("city", true);
      render();
    }
  });
  $("#acts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    doAct(S.cities[S.sel], b.dataset.act);
  });
  $("#airRoutesBox").addEventListener("click", (e) => {
    const b = e.target.closest("[data-airfreq]");
    if (!b || b.disabled) return;
    const r = S.airRoutes[+b.dataset.airfreq];
    if (!r) return;
    const delta = +b.dataset.delta,
      next = clamp(flightsPerMonth(r) + delta, 1, AIR_MAX_FREQ);
    if (next === flightsPerMonth(r)) return;
    if (delta > 0) {
      const cost = airFreqCost(r);
      if (!spend(cost, "aviation")) {
        flash("Не хватает денег, чтобы увеличить число рейсов.");
        return;
      }
    }
    r.fpm = next;
    logEv(
      "Расписание авиамаршрута " +
        S.cities[r.a].name +
        " – " +
        S.cities[r.b].name +
        ": " +
        next +
        " рейсов в месяц",
    );
    evaluate();
    render();
  });
  $("#cargoRoutesBody").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-cargorm]");
    if (!rm) return;
    const r = S.cargoRoutes.splice(+rm.dataset.cargorm, 1)[0];
    if (r) logEv("Закрыт грузовой маршрут: " + S.cities[r.a].name + " – " + S.cities[r.b].name);
    evaluate();
    render();
  });
  $("#tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    stopRename(false);
    S.sel = +tr.dataset.i;
    setRoadSel(null);
    render();
  });
  $("#renameBtn").addEventListener("click", startRename);
  RC.addEventListener("pointerdown", (e) => {
    RC.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    setDragMoved(false);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      setPinch0({ d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: V.z });
    }
  });
  RC.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (placingCapital) {
        setGhost(mapPos(e));
        const why = startCityProblem(ghost.x, ghost.y);
        $("#startCityStatus").textContent = why || "Это место подходит.";
        $("#startCityStatus").classList.toggle("error", !!why);
        showPlacementPreview(e, ghost);
        drawRegion();
      } else if (founding) {
        setGhost(mapPos(e));
        showPlacementPreview(e, ghost);
        drawRegion();
      } else if (rdraw) {
        rdraw.hover = mapPos(e);
        drawRegion();
      } else if (airDraft) {
        airDraft.hover = mapPos(e);
        drawRegion();
      } else if (cargoDraft) {
        cargoDraft.hover = mapPos(e);
        drawRegion();
      } else if (pmode) {
        setPHover(mapPos(e));
        drawRegion();
      } else probeRegion(e);
      return;
    }
    if (ptrs.size === 2 && pinch0) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...ptrs.values()],
        d = Math.hypot(a.x - b.x, a.y - b.y),
        r = RC.getBoundingClientRect();
      zoomAt((pinch0.z * d) / pinch0.d / V.z, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      setDragMoved(true);
      return;
    }
    if (!dragMoved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 5) {
      if (placingCapital || founding) {
        setGhost(mapPos(e));
        showPlacementPreview(e, ghost);
        drawRegion();
      }
      return;
    }
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    setDragMoved(true);
    p.x = e.clientX;
    p.y = e.clientY;
    const s = (RC.getBoundingClientRect().width / RW) * V.z;
    V.cx -= dx / s;
    if (S.planet) V.cx = wrapX(V.cx);
    V.cy -= dy / s;
    drawRegion();
  });
  RC.addEventListener("pointerup", endPtr);
  RC.addEventListener("pointercancel", endPtr);
  RC.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = RC.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  $("#zIn").addEventListener("click", () => zoomBtn(1.6));
  $("#zOut").addEventListener("click", () => zoomBtn(1 / 1.6));
  $("#zAll").addEventListener("click", () => {
    V.z = 1;
    V.cx = RW / 2;
    V.cy = RH / 2;
    drawRegion();
  });
}
