/**
 * Плитки печатной карты рельефа: очередь, воркеры, кеш и рисование.
 *
 * Карта мира делится на плитки 256×256 пикселей по уровням: на уровне L колонок 2^(L+1), строк 2^L.
 * Уровень выбирается по масштабу так, чтобы пиксель плитки был примерно равен пикселю экрана.
 * Пока нужной плитки нет, рисуется более крупная плитка родителя, поэтому дырок не бывает.
 */
import ReliefWorker from "./worker?worker&inline";
import {
  TILE,
  prepareBase,
  renderTile,
  tileSize,
  type PreparedBase,
  type ReliefBase,
} from "./render";

export const MAX_LEVEL = 8;
const CACHE_LIMIT = 260;

interface Entry {
  canvas: HTMLCanvasElement;
  used: number;
  /** Плитку надо пересчитать, но пока показывается прежняя, чтобы карта не мигала. */
  stale?: boolean;
}
/** Береговая «подушка» вокруг города видна только на плитках, где пиксель не крупнее этого, км. */
const ANCHOR_VISIBLE_KM = 6;
interface Task {
  L: number;
  tx: number;
  ty: number;
  frame: number;
  dist: number;
}
interface Slot {
  worker: Worker | null;
  busy: Task | null;
  version: number;
}

let base: ReliefBase | null = null;
let local: PreparedBase | null = null; // запасной путь без воркеров
let signature = "";
let generation = 0;
let anchorVersion = 0;
let anchors: number[] = [];
let frame = 0;
let nextId = 1;
const cache = new Map<string, Entry>();
const pending = new Map<string, Task>();
const slots: Slot[] = [];
const inflight = new Map<number, { key: string; task: Task; gen: number; anchorVersion: number }>();
let onUpdate: (() => void) | null = null;
let fallbackTimer = 0;
let workersFailed = false;

const keyOf = (L: number, tx: number, ty: number) => `${generation}:${L}:${tx}:${ty}`;

export function setReliefUpdateHandler(fn: () => void) {
  onUpdate = fn;
}
export function reliefStats() {
  return {
    generation,
    cached: cache.size,
    pending: pending.size,
    inflight: inflight.size,
    workers: slots.filter((s) => s.worker).length,
    fallback: workersFailed,
    ready: !!base,
    coarse: reliefHasCoarse(),
  };
}
export function reliefReady() {
  return !!base;
}

/** Передаёт данные новой планеты. Если планета та же, ничего не сбрасывает. */
export function reliefReset(next: ReliefBase, sig: string) {
  if (sig === signature && base) {
    setReliefAnchors(next.anchors);
    return;
  }
  signature = sig;
  generation++;
  cache.clear();
  pending.clear();
  inflight.clear();
  base = { ...next, anchors: next.anchors.slice() };
  anchors = base.anchors;
  local = null;
  ensureWorkers();
  for (const slot of slots) {
    slot.busy = null;
    slot.worker?.postMessage({ type: "init", base });
  }
  // крупные уровни нужны всегда: на них держится картинка, пока считаются мелкие
  for (let L = 0; L <= 1; L++)
    for (let ty = 0; ty < 2 ** L; ty++)
      for (let tx = 0; tx < 2 ** (L + 1); tx++) want(L, tx, ty, 1e9);
  pump();
}

function ensureWorkers() {
  if (slots.length || workersFailed) return;
  const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  try {
    for (let i = 0; i < n; i++) {
      const worker = new ReliefWorker();
      const slot: Slot = { worker, busy: null, version: 0 };
      worker.onmessage = (e) => onResult(slot, e.data);
      worker.onerror = () => failWorkers();
      slots.push(slot);
    }
  } catch (e) {
    failWorkers();
  }
}
function failWorkers() {
  if (workersFailed) return;
  workersFailed = true;
  for (const s of slots) s.worker?.terminate();
  slots.length = 0;
  inflight.clear();
  // воркеры недоступны: перерисовка заново запросит плитки, и они посчитаются в основном потоке
  onUpdate?.();
}

/** Города — «якоря»: вокруг них береговая линия не отодвигается в воду. */
export function setReliefAnchors(next: number[]) {
  if (!base) return;
  if (next.length === anchors.length && next.every((v, i) => v === anchors[i])) return;
  const added: number[] = [];
  for (let i = 0; i < next.length; i += 2) {
    let known = false;
    for (let j = 0; j < anchors.length; j += 2)
      if (anchors[j] === next[i] && anchors[j + 1] === next[i + 1]) known = true;
    if (!known) added.push(next[i], next[i + 1]);
  }
  anchors = next.slice();
  base.anchors = anchors;
  anchorVersion++;
  for (const slot of slots) slot.worker?.postMessage({ type: "anchors", anchors });
  if (local) local.anchors = anchors;
  // Плитки возле новых городов надо пересчитать. Крупные уровни не трогаем: подушка там меньше
  // пикселя, а именно они держат картинку. Устаревшая плитка остаётся на экране до замены.
  for (const [key, entry] of cache) {
    const [g, L, tx, ty] = key.split(":").map(Number);
    if (g !== generation || tileSize(base, L).th / TILE > ANCHOR_VISIBLE_KM) continue;
    if (touches(L, tx, ty, added)) entry.stale = true;
  }
}
function touches(L: number, tx: number, ty: number, pts: number[]) {
  if (!base || !pts.length) return false;
  const { tw, th } = tileSize(base, L),
    pad = 40;
  for (let i = 0; i < pts.length; i += 2)
    if (
      pts[i] > tx * tw - pad &&
      pts[i] < (tx + 1) * tw + pad &&
      pts[i + 1] > ty * th - pad &&
      pts[i + 1] < (ty + 1) * th + pad
    )
      return true;
  return false;
}

function want(L: number, tx: number, ty: number, dist: number) {
  const key = keyOf(L, tx, ty);
  const have = cache.get(key);
  if (have) {
    have.used = frame;
    if (!have.stale) return;
  }
  const queued = pending.get(key);
  if (queued) {
    queued.frame = frame;
    queued.dist = Math.min(queued.dist, dist);
    return;
  }
  for (const f of inflight.values()) if (f.key === key) return;
  pending.set(key, { L, tx, ty, frame, dist });
}

function pump() {
  if (!base) return;
  if (workersFailed) {
    if (!fallbackTimer && pending.size)
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = 0;
        const task = takeBest();
        if (!task || !base) return;
        local = local || prepareBase(base);
        local.anchors = anchors;
        store(keyOf(task.L, task.tx, task.ty), renderTile(local, task.L, task.tx, task.ty));
        pump();
      }, 0);
    return;
  }
  for (const slot of slots) {
    if (slot.busy || !slot.worker) continue;
    const task = takeBest();
    if (!task) break;
    const id = nextId++,
      key = keyOf(task.L, task.tx, task.ty);
    slot.busy = task;
    inflight.set(id, { key, task, gen: generation, anchorVersion });
    slot.worker.postMessage({ type: "tile", id, L: task.L, tx: task.tx, ty: task.ty });
  }
}
/** Берёт самую свежую и ближайшую к центру экрана плитку. */
function takeBest(): Task | null {
  let best: Task | null = null,
    bestKey = "";
  for (const [key, t] of pending)
    if (!best || t.frame > best.frame || (t.frame === best.frame && t.dist < best.dist)) {
      best = t;
      bestKey = key;
    }
  if (best) pending.delete(bestKey);
  return best;
}
function store(key: string, pixels: Uint8ClampedArray) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, TILE, TILE), 0, 0);
  cache.set(key, { canvas, used: frame });
  if (cache.size > CACHE_LIMIT) {
    const old = [...cache.entries()]
      .sort((a, b) => a[1].used - b[1].used)
      .slice(0, cache.size - CACHE_LIMIT + 20);
    for (const [k] of old) cache.delete(k);
  }
  onUpdate?.();
}
function onResult(slot: Slot, m: { type: string; id: number; pixels: Uint8ClampedArray }) {
  const job = inflight.get(m.id);
  slot.busy = null;
  inflight.delete(m.id);
  if (job && job.gen === generation) {
    if (job.anchorVersion !== anchorVersion) {
      // пока плитка считалась, появился город: считаем заново, если она ещё нужна
      pending.set(job.key, { ...job.task, frame });
    } else store(job.key, m.pixels);
  }
  pump();
}

/** Рисует видимые плитки. Контекст уже сдвинут на смещение карты и на копию мира по долготе. */
export function drawRelief(
  ctx: CanvasRenderingContext2D,
  s: number,
  wrapShift: number,
  w: number,
  h: number,
  OX: number,
  OY: number,
  cities: { x: number; y: number }[],
): boolean {
  if (!base) return false;
  const pts: number[] = [];
  for (const c of cities) pts.push(c.x, c.y);
  setReliefAnchors(pts);
  const worldW = base.worldW,
    worldH = base.worldH;
  const L = Math.max(0, Math.min(MAX_LEVEL, Math.round(Math.log2((worldH * s) / TILE))));
  const left = Math.max(0, -OX / s - wrapShift),
    right = Math.min(worldW, (w - OX) / s - wrapShift),
    top = Math.max(0, -OY / s),
    bottom = Math.min(worldH, (h - OY) / s);
  if (right <= left || bottom <= top) return true;
  const { tw, th } = tileSize(base, L),
    cx = (left + right) / 2,
    cy = (top + bottom) / 2,
    tx0 = Math.floor(left / tw),
    tx1 = Math.min(2 ** (L + 1) - 1, Math.floor((right - 1e-6) / tw)),
    ty0 = Math.floor(top / th),
    ty1 = Math.min(2 ** L - 1, Math.floor((bottom - 1e-6) / th));
  let covered = true;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      const dist = Math.hypot((tx + 0.5) * tw - cx, (ty + 0.5) * th - cy);
      want(L, tx, ty, dist);
      if (!paint(ctx, s, L, tx, ty, L, tx, ty, tw, th)) {
        let done = false;
        for (let l = L - 1; l >= 0 && !done; l--) {
          const shift = L - l;
          done = paint(ctx, s, l, tx >> shift, ty >> shift, L, tx, ty, tw, th);
        }
        if (!done) covered = false;
        if (L > 1) want(L - 1, tx >> 1, ty >> 1, dist * 2);
      }
    }
  ctx.restore();
  pump();
  return covered;
}
/** Вызывается один раз за кадр перед рисованием копий мира: старые запросы забываются. */
export function reliefBeginFrame() {
  frame++;
  pending.clear();
  ensureCoarse();
}
/** Две самые крупные плитки держат картинку, пока нет мелких: если их нет, запрашиваем снова. */
function ensureCoarse() {
  if (!base) return;
  for (let L = 0; L <= 1; L++)
    for (let ty = 0; ty < 2 ** L; ty++)
      for (let tx = 0; tx < 2 ** (L + 1); tx++)
        if (!cache.has(keyOf(L, tx, ty))) want(L, tx, ty, 1e9);
  pump();
}
/** Есть ли самый крупный уровень (две плитки на весь мир): с него можно показывать карту. */
export function reliefHasCoarse() {
  return !!base && cache.has(keyOf(0, 0, 0)) && cache.has(keyOf(0, 1, 0));
}

/** Рисует плитку (l, tx, ty) в прямоугольник плитки (L, ox, oy). */
function paint(
  ctx: CanvasRenderingContext2D,
  s: number,
  l: number,
  tx: number,
  ty: number,
  L: number,
  ox: number,
  oy: number,
  tw: number,
  th: number,
): boolean {
  const entry = cache.get(keyOf(l, tx, ty));
  if (!entry) return false;
  entry.used = frame;
  const k = 2 ** (L - l),
    sub = TILE / k,
    sx = (ox - tx * k) * sub,
    sy = (oy - ty * k) * sub,
    dx = Math.floor(ox * tw * s),
    dy = Math.floor(oy * th * s),
    dw = Math.ceil((ox + 1) * tw * s) - dx + 1,
    dh = Math.ceil((oy + 1) * th * s) - dy + 1;
  ctx.drawImage(entry.canvas, sx, sy, sub, sub, dx, dy, dw, dh);
  return true;
}
