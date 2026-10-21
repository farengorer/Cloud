import { G } from "./config";

export let S = null;
export function setS(v) {
  S = v;
  return v;
}
export let rng = null;
export function setRng(v) {
  rng = v;
  return v;
}
export let lastPairs = [];
export function setLastPairs(v) {
  lastPairs = v;
  return v;
}
export let RIVER_INDEX_T = null;
export function setRIVER_INDEX_T(v) {
  RIVER_INDEX_T = v;
  return v;
}
export let RIVER_INDEX = null;
export function setRIVER_INDEX(v) {
  RIVER_INDEX = v;
  return v;
}
export let RIVER_STAMP = 0;
export function setRIVER_STAMP(v) {
  RIVER_STAMP = v;
  return v;
}
export let SEA_ROUTE_GRID = null;
export function setSEA_ROUTE_GRID(v) {
  SEA_ROUTE_GRID = v;
  return v;
}
export let TT = [];
export function setTT(v) {
  TT = v;
  return v;
}
export let C: Record<string, any> = {};
export let terrainImg = null;
export function setTerrainImg(v) {
  terrainImg = v;
  return v;
}
export let biomeImg = null;
export let texVer = 0;
export function setTexVer(v) {
  texVer = v;
  return v;
}
export let FONT = { d: "sans-serif", b: "sans-serif", m: "monospace" };
export let founding = false;
export function assignFounding(v) {
  founding = v;
  return v;
}
export let ghost = null;
export function setGhost(v) {
  ghost = v;
  return v;
}
export let placingCapital = false;
export function setPlacingCapital(v) {
  placingCapital = v;
  return v;
}
export let pendingStart = null;
export function setPendingStart(v) {
  pendingStart = v;
  return v;
}
export let roadSel = null;
export function setRoadSel(v) {
  roadSel = v;
  return v;
}
export let mode = "road";
export let lastGameDate = "";
export function setLastGameDate(v) {
  lastGameDate = v;
  return v;
}
export let playing = false;
export function setPlaying(v) {
  playing = v;
  return v;
}
export let yps = 1 / 12;
export function setYps(v) {
  yps = v;
  return v;
}
export let acc = 0;
export function setAcc(v) {
  acc = v;
  return v;
}
export let lastT = 0;
export function setLastT(v) {
  lastT = v;
  return v;
}
export let renaming = false;
export function setRenaming(v) {
  renaming = v;
  return v;
}
export let APP_PREFS = {
  theme: "system",
  speed: 1 / 12,
  autosave: true,
  foreignStates: 0,
  geoNames: true,
  resources: true,
  musicVolume: 0.35,
};
export function setAPP_PREFS(v) {
  APP_PREFS = v;
  return v;
}
export let hasActiveGame = false;
export function setHasActiveGame(v) {
  hasActiveGame = v;
  return v;
}
export let musicPlaying = false;
export function setMusicPlaying(v) {
  musicPlaying = v;
  return v;
}
export let dragMoved = false;
export function setDragMoved(v) {
  dragMoved = v;
  return v;
}
export let pinch0 = null;
export function setPinch0(v) {
  pinch0 = v;
  return v;
}
export let cmode = "growth";
export function setCmode(v) {
  cmode = v;
  return v;
}
export let ZONE: Record<string, any> = { show: false, key: "", img: null, roots: [], parent: [] };
export let dEdit = null;
export function setDEdit(v) {
  dEdit = v;
  return v;
}
export let dPick = null;
export function setDPick(v) {
  dPick = v;
  return v;
}
export let rdraw = null;
export function setRdraw(v) {
  rdraw = v;
  return v;
}
export let rmode = "road";
export function setRmode(v) {
  rmode = v;
  return v;
}
export let cargoDraft = null;
export function setCargoDraft(v) {
  cargoDraft = v;
  return v;
}
export let territoryPage = 0;
export function setTerritoryPage(v) {
  territoryPage = v;
  return v;
}
export let mdraw = null;
export function setMdraw(v) {
  mdraw = v;
  return v;
}
export let cghost = null;
export function setCghost(v) {
  cghost = v;
  return v;
}
export let CZ = { z: 1, px: 0, py: 0, city: -1 };
export function setCZ(v) {
  CZ = v;
  return v;
}
export let LASTCV = { x0: 0, y0: 0, s: 1, size: G };
export function setLASTCV(v) {
  LASTCV = v;
  return v;
}
export let cdrag = null;
export function setCdrag(v) {
  cdrag = v;
  return v;
}
export let cMoved = false;
export function setCMoved(v) {
  cMoved = v;
  return v;
}
export let entSelK = null;
export function setEntSelK(v) {
  entSelK = v;
  return v;
}
export let DB = null;
export function setDB(v) {
  DB = v;
  return v;
}
export let USERC = null;
export function setUSERC(v) {
  USERC = v;
  return v;
}
export let UID = null;
export function setUID(v) {
  UID = v;
  return v;
}
export let MP = null;
export function setMP(v) {
  MP = v;
  return v;
}
export let GAMES = [];
export function setGAMES(v) {
  GAMES = v;
  return v;
}
export let NAMESC = {};
export let CANWRITE = null;
export function setCANWRITE(v) {
  CANWRITE = v;
  return v;
}
export let onMsg = "";
export function setOnMsg(v) {
  onMsg = v;
  return v;
}
export let wq = Promise.resolve();
export function setWq(v) {
  wq = v;
  return v;
}
export let pmode = null;
export function setPmode(v) {
  pmode = v;
  return v;
}
export let pHover = null;
export function setPHover(v) {
  pHover = v;
  return v;
}
export let bdraw = false;
export function setBdraw(v) {
  bdraw = v;
  return v;
}
export let bizMsg = "";
export function setBizMsg(v) {
  bizMsg = v;
  return v;
}
export let VIEW = "region";
export function setVIEW(v) {
  VIEW = v;
  return v;
}
export let TAB = "city";
export function setTAB(v) {
  TAB = v;
  return v;
}
export let LAYER = "growth";
export function setLAYER(v) {
  LAYER = v;
  return v;
}
export let CLAYER = "plan";
export function setCLAYER(v) {
  CLAYER = v;
  return v;
}
export let FLOWS = true;
export function setFLOWS(v) {
  FLOWS = v;
  return v;
}
export let HINTMSG = "";
export function setHINTMSG(v) {
  HINTMSG = v;
  return v;
}
export let hintT = 0;
export function setHintT(v) {
  hintT = v;
  return v;
}
export let airDraft = null;
export function setAirDraft(v) {
  airDraft = v;
  return v;
}
export let claimMode = false;
export function setClaimMode(v) {
  claimMode = v;
  return v;
}
export let rt = 0;
export function setRt(v) {
  rt = v;
  return v;
}
