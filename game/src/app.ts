import { MONTH } from "./actions";
import { buildTerrainImg, readColors } from "./colors";
import { YMAX } from "./config";
import { loadAppPrefs, refreshSaveStatus, setPlay } from "./controls";
import { fonts, render, updateGameDate } from "./draw";
import { init, stepMonth } from "./model";
import { mpInit } from "./multiplayer";
import { saveGame } from "./saveload";
import {
  APP_PREFS,
  DB,
  MP,
  S,
  acc,
  lastT,
  placingCapital,
  playing,
  renaming,
  rt,
  setAcc,
  setLastT,
  setRt,
  setTexVer,
  texVer,
  yps,
} from "./state";
import { $, clamp } from "./util";
import { setTool } from "./views";

export function closeMax() {}
export function regionAspect(cv) {
  const p = cv.parentElement;
  return clamp(p.clientHeight / Math.max(1, p.clientWidth), 0.15, 4);
}
function tick(t) {
  if (playing && S.year >= YMAX) setPlay(false);
  if (playing && !renaming && !MP) {
    setAcc(acc + ((t - lastT) / 1000) * yps);
    let k = 0;
    while (acc >= MONTH && k < 36) {
      stepMonth();
      setAcc(acc - MONTH);
      k++;
      if (S.monthIndex === 0 && S.year % 100 === 0 && !DB && APP_PREFS.autosave) {
        saveGame("solo");
        refreshSaveStatus();
      }
    }
    if (k) render();
    if (acc > 36) setAcc(0);
  }
  updateGameDate();
  setLastT(t);
  requestAnimationFrame(tick);
}
function themeChanged() {
  readColors();
  setTexVer(texVer + 1);
  buildTerrainImg();
  if (S) render();
}
const mq = window.matchMedia("(prefers-color-scheme: dark)");

export function setupApp() {
  document.addEventListener("keydown", (e) => {
    const tg = e.target,
      typing =
        tg &&
        ((tg as HTMLElement).tagName === "INPUT" ||
          (tg as HTMLElement).tagName === "SELECT" ||
          (tg as HTMLElement).tagName === "TEXTAREA");
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !$("#startPanel").hidden) return;
    if (e.key === " " && (tg as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      setPlay(!playing);
    } else if (e.key === "f" || e.key === "а") setTool("found");
    else if (e.key === "r" || e.key === "к") setTool("road");
  });
  if (mq.addEventListener) mq.addEventListener("change", themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    setRt(
      setTimeout(() => {
        if (S) render();
      }, 120),
    );
  });
  if (window.innerWidth < 820) {
    $("#legendBox").classList.add("min");
    $("#lgToggle").textContent = "легенда";
  }
  loadAppPrefs();
  readColors();
  fonts();
  init(20261018);
  render();
  refreshSaveStatus();
  setLastT(performance.now());
  requestAnimationFrame(tick);
  mpInit();
  window.addEventListener("pagehide", () => {
    if (APP_PREFS.autosave && S && !MP && !placingCapital) saveGame("solo");
  });
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol))
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./service-worker.js").catch(() => {}),
    );
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      fonts();
      render();
    });
}
