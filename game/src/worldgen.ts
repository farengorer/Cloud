import { makeBiomeImg } from "./colors";
import { RH, RW } from "./config";
import { geoXY, nearX, wrapX } from "./model";
import { S } from "./state";
import { reliefHeightAt, riftAt, tectonicAt } from "./terrain";
import { clamp, fbm, mulberry32, segDist, wrappedFbm } from "./util";

export function seaD(x, y) {
  const sea = S.T.sea;
  if (!sea) return 1e9;
  if (sea.planet) {
    if (isIceAt(x, y)) return -10000;
    const tx = wrapX(x),
      crust = tectonicAt(tx, y),
      rift = riftAt(tx, y);
    let best = -1e9;
    for (const c of sea.continents) {
      const raw = tx - c.x,
        dx = raw - Math.round(raw / RW) * RW,
        dy = y - c.y,
        ca = Math.cos(c.a),
        sa = Math.sin(c.a),
        u = (dx * ca + dy * sa) / c.rx,
        v = (-dx * sa + dy * ca) / c.ry,
        r = Math.sqrt(u * u + v * v),
        minor = Math.min(c.rx, c.ry),
        shape = (1 - r) * minor;
      if (shape + minor * c.coastLimit <= best) continue;
      const a = (Math.atan2(v, u) / (Math.PI * 2) + 1) % 1,
        profile = c.coastProfile,
        at = a * profile.length,
        i = Math.floor(at),
        f = at - i,
        coast = minor * (profile[i] + (profile[(i + 1) % profile.length] - profile[i]) * f);
      let value = shape + coast;
      if (c.waist) {
        const along = u * c.waist.ca + v * c.waist.sa,
          across = -u * c.waist.sa + v * c.waist.ca;
        for (const side of [-1, 1]) {
          const q = Math.hypot(
              along / c.waist.along,
              (across - side * c.waist.offset) / c.waist.across,
            ),
            cut = (1 - q) * minor;
          if (cut > 0) value = Math.min(value, -cut);
        }
      }
      best = Math.max(best, value);
    }
    if (best <= 0) return best;
    return Math.max(1, best + crust * 12 - rift * 10);
  }
  const n = S.T.nS,
    L = sea.side === 0 || sea.side === 2 ? x : y,
    D = sea.depth * (0.55 + 0.9 * fbm(n, L / 55 + 40, sea.side * 7 + 3));
  if (sea.side === 0) return y - D;
  if (sea.side === 2) return RH - D - y;
  if (sea.side === 1) return RW - D - x;
  return x - D;
}
export function mtVal(x, y) {
  const R = S.T.ridge;
  let m = 0;
  if (R) {
    let dmin = 1e9;
    for (let i = 0; i < R.pts.length - 1; i++) {
      const d = segDist(x, y, R.pts[i][0], R.pts[i][1], R.pts[i + 1][0], R.pts[i + 1][1]);
      if (d < dmin) dmin = d;
    }
    if (dmin <= R.w)
      m = clamp((1 - dmin / R.w) * (0.65 + 0.7 * S.T.nE(x / 9 + 50, y / 9 + 20)), 0, 1);
  }
  return Math.max(m, tectonicAt(x, y));
}
export function seaPoly() {
  const sea = S.T.sea,
    pts = [];
  const along = sea.side === 0 || sea.side === 2 ? RW : RH;
  for (let t = -12; t <= along + 12; t += 3) {
    const n = S.T.nS,
      D = sea.depth * (0.55 + 0.9 * fbm(n, t / 55 + 40, sea.side * 7 + 3));
    if (sea.side === 0) pts.push([t, D]);
    else if (sea.side === 2) pts.push([t, RH - D]);
    else if (sea.side === 1) pts.push([RW - D, t]);
    else pts.push([D, t]);
  }
  if (sea.side === 0) pts.push([RW + 12, -12], [-12, -12]);
  else if (sea.side === 2) pts.push([RW + 12, RH + 12], [-12, RH + 12]);
  else if (sea.side === 1) pts.push([RW + 12, RH + 12], [RW + 12, -12]);
  else pts.push([-12, RH + 12], [-12, -12]);
  return pts;
}
export function isIceAt(x, y) {
  return y < RH * ((90 - 66.5) / 180) || y > RH * (1 - (90 - 66.5) / 180);
}
const FANTASY_CONT_NAMES = [
  "Эльдора",
  "Велария",
  "Остран",
  "Нордания",
  "Кайрос",
  "Меридиан",
  "Таврия",
  "Искра",
  "Аврора",
  "Зелёный материк",
  "Сарматия",
  "Равнина ветров",
];
const CONTINENT_NAME_LIBRARY = [
  "Европа",
  "Азия",
  "Америка",
  "Австралия",
  "Астазия",
  "Зендария",
  "Алландир",
  "Пангея",
  "Гея Магна",
  "Мазария",
  "Африка",
  "Инаррия",
  "Шаокатан",
  "Геронея",
  "Окатия",
];
function geographicContinentNames(count, rr) {
  const names = CONTINENT_NAME_LIBRARY.slice();
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rr() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names.slice(0, count);
}
const RANGE_NAMES = [
  "Хребет Семи вершин",
  "Каменистый Пояс",
  "Горы Рассвета",
  "Серебряная Корона",
  "Огненная дуга",
  "Хребет Дождевых Туч",
  "Высокие Врата",
  "Горы Синего Камня",
];
const RIVER_NAMES = [
  "Река Арда",
  "Великая Сава",
  "Оленья река",
  "Река Тихих земель",
  "Белая вода",
  "Река Кедров",
  "Лента",
  "Ирена",
  "Длинная река",
  "Золотая река",
  "Река Семи долин",
  "Северный поток",
  "Серая река",
  "Река Ветров",
];
const LAKE_NAMES = [
  "Лазурное озеро",
  "Озеро Зеркал",
  "Большое Каменное",
  "Синяя чаша",
  "Озеро Туманов",
  "Тихое озеро",
  "Белая лагуна",
];
function buildTectonics(T, count, rr) {
  const n = clamp(8 + count * 2, 10, 24),
    plates = [];
  for (let i = 0; i < n; i++) {
    let x,
      y,
      kind = "океаническая";
    if (i < count * 2) {
      const c = T.sea.continents[i % count],
        a = rr() * Math.PI * 2,
        r = 0.12 + rr() * 0.55;
      x = wrapX(c.x + Math.cos(a) * c.rx * r);
      y = clamp(c.y + Math.sin(a) * c.ry * r, RH * 0.14, RH * 0.86);
      kind = "континентальная";
    } else {
      const lat = Math.asin(rr() * 2 - 1);
      x = rr() * RW;
      y = RH * (0.5 - lat / Math.PI);
    }
    const a = rr() * Math.PI * 2,
      speed = 0.35 + rr() * 0.9;
    plates.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, kind });
  }
  const W = 360,
    H = 180,
    uplift = new Float32Array(W * H),
    rift = new Float32Array(W * H),
    plate = new Uint8Array(W * H);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const x = ((gx + 0.5) * RW) / W,
        y = ((gy + 0.5) * RH) / H;
      let a = -1,
        b = -1,
        da = Infinity,
        db = Infinity;
      for (let i = 0; i < n; i++) {
        const d = geoXY(x, y, plates[i].x, plates[i].y);
        if (d < da) {
          db = da;
          b = a;
          da = d;
          a = i;
        } else if (d < db) {
          db = d;
          b = i;
        }
      }
      const p = plates[a],
        q = plates[b],
        dx = nearX(q.x, p.x) - p.x,
        dy = q.y - p.y,
        len = Math.max(1, Math.hypot(dx, dy)),
        closing = ((p.vx - q.vx) * dx + (p.vy - q.vy) * dy) / len;
      const seam = clamp(1 - (db - da) / 480, 0, 1),
        ix = gy * W + gx;
      plate[ix] = a;
      uplift[ix] = seam * clamp(0.12 + closing * 0.72, 0.04, 1);
      rift[ix] = seam * clamp(-closing * 0.8, 0, 1);
    }
  T.plates = plates;
  T.tectonics = { W, H, uplift, rift, plate };
}
function buildBiomeGrid(T) {
  const W = 720,
    H = 360,
    data = new Uint8Array(W * H);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const x = ((gx + 0.5) * RW) / W,
        y = ((gy + 0.5) * RH) / H,
        k = gy * W + gx;
      if (isIceAt(x, y) || seaD(x, y) < 0) {
        data[k] = 0;
        continue;
      }
      const lat = Math.abs(90 - (y / RH) * 180),
        u = tectonicAt(x, y),
        e = wrappedFbm(T.nE, x, y, 190) + u * 1.25,
        temp = 1 - lat / 90 - e * 0.22;
      const coast = clamp(1 - seaD(x, y) / 850, 0, 1),
        moist = clamp(
          wrappedFbm(T.nF, x, y, 250) * 0.52 +
            wrappedFbm(T.nD, x, y, 85) * 0.25 +
            coast * 0.18 +
            0.12,
          0,
          1,
        );
      let b;
      if (u > 0.68 || e > 0.88) b = 7;
      else if (temp < 0.12) b = 1;
      else if (temp < 0.33) b = moist > 0.36 ? 2 : 1;
      else if (temp < 0.57) b = moist > 0.56 ? 3 : moist > 0.39 ? 4 : 5;
      else if (temp < 0.78) b = moist > 0.68 ? 3 : moist > 0.45 ? 4 : moist > 0.3 ? 8 : 5;
      else b = moist > 0.61 ? 6 : moist > 0.39 ? 4 : 5;
      data[k] = b;
    }
  T.biomeGrid = { W, H, data };
}
function generateRivers(T, seed) {
  const rr = mulberry32((seed ^ 0x3c6ef372) >>> 0),
    W = 720,
    H = 360,
    N = W * H,
    land = new Uint8Array(N),
    water = new Uint8Array(N),
    iceCell = new Uint8Array(N),
    height = new Float32Array(N),
    filled = new Float32Array(N),
    down = new Int32Array(N),
    seen = new Uint8Array(N),
    component = new Int32Array(N),
    stepX = RW / W,
    stepY = RH / H;
  down.fill(-1);
  component.fill(-1);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const k = gy * W + gx,
        x = (gx + 0.5) * stepX,
        y = (gy + 0.5) * stepY,
        ice = isIceAt(x, y),
        sd = ice ? -10000 : seaD(x, y);
      if (ice) {
        water[k] = 1;
        iceCell[k] = 1;
        continue;
      }
      if (sd < 0) {
        water[k] = 1;
        continue;
      }
      land[k] = 1;
      height[k] = reliefHeightAt(x, y, sd);
    }
  // Identify separate landmasses so every large continent can receive its own river system.
  const components = [],
    queue = new Int32Array(N);
  for (let k = 0; k < N; k++) {
    if (!land[k] || component[k] >= 0) continue;
    const id = components.length;
    let head = 0,
      tail = 0;
    queue[tail++] = k;
    component[k] = id;
    while (head < tail) {
      const at = queue[head++],
        gx = at % W,
        gy = (at / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = gy + oy;
        if (ny < 0 || ny >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = (gx + ox + W) % W,
            q = ny * W + nx;
          if (land[q] && component[q] < 0) {
            component[q] = id;
            queue[tail++] = q;
          }
        }
      }
    }
    components.push({ cells: Array.from(queue.subarray(0, tail)), area: tail });
  }
  // Priority-flood drainage: every inland cell gets a downhill route to the nearest ocean outlet.
  const heapI = [],
    heapH = [];
  function push(k, h) {
    let i = heapI.length;
    heapI.push(k);
    heapH.push(h);
    while (i) {
      const p = (i - 1) >> 1;
      if (heapH[p] <= h) break;
      heapI[i] = heapI[p];
      heapH[i] = heapH[p];
      i = p;
      heapI[i] = k;
      heapH[i] = h;
    }
  }
  function pop() {
    const k = heapI[0],
      h = heapH[0],
      lastI = heapI.pop(),
      lastH = heapH.pop();
    if (heapI.length) {
      let i = 0;
      heapI[0] = lastI;
      heapH[0] = lastH;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heapI.length) break;
        if (c + 1 < heapI.length && heapH[c + 1] < heapH[c]) c++;
        if (heapH[i] <= heapH[c]) break;
        [heapI[i], heapI[c]] = [heapI[c], heapI[i]];
        [heapH[i], heapH[c]] = [heapH[c], heapH[i]];
        i = c;
      }
    }
    return [k, h];
  }
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const k = gy * W + gx;
      if (!land[k]) continue;
      let coast = false;
      for (let oy = -1; oy <= 1 && !coast; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const ny = gy + oy;
          if (ny < 0 || ny >= H) continue;
          const nx = (gx + ox + W) % W,
            q = ny * W + nx;
          if (water[q] && !iceCell[q]) {
            coast = true;
            break;
          }
        }
      if (coast) {
        seen[k] = 1;
        filled[k] = height[k];
        push(k, filled[k]);
      }
    }
  while (heapI.length) {
    const [k, h] = pop(),
      gx = k % W,
      gy = (k / W) | 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const ny = gy + oy;
        if (ny < 0 || ny >= H) continue;
        const nx = (gx + ox + W) % W,
          q = ny * W + nx;
        if (!land[q] || seen[q]) continue;
        seen[q] = 1;
        filled[q] = Math.max(height[q], h + 0.00001);
        down[q] = k;
        push(q, filled[q]);
      }
  }
  const rivers = [],
    lakes = [],
    sourcePts = [],
    riverCells = new Uint8Array(N),
    large = components.filter((c) => c.area >= 90).sort((a, b) => b.area - a.area),
    main = large.length ? large : components.sort((a, b) => b.area - a.area).slice(0, 1),
    target = clamp(main.length * 4, 12, 36),
    quota = main.map(() => 1);
  while (quota.reduce((a, b) => a + b, 0) < target) {
    let best = 0;
    for (let i = 1; i < main.length; i++)
      if (main[i].area / (quota[i] + 1) > main[best].area / (quota[best] + 1)) best = i;
    quota[best]++;
  }
  // Guarantee one drainage path for each named continent, even when a narrow isthmus joins it to another landmass.
  function riverGeometry(path) {
    const pts = [];
    let prevX = 0;
    for (const k of path) {
      const p = [((k % W) + 0.5) * stepX, (((k / W) | 0) + 0.5) * stepY];
      p[0] = pts.length ? nearX(p[0], prevX) : p[0];
      pts.push(p);
      prevX = p[0];
    }
    const end = path[path.length - 1];
    if (end >= 0 && down[end] < 0 && pts.length > 1) {
      const gx = end % W,
        gy = (end / W) | 0,
        a = pts[pts.length - 1],
        before = pts[pts.length - 2],
        ix = a[0] - before[0],
        iy = a[1] - before[1],
        il = Math.hypot(ix, iy) || 1;
      let best = null;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const ny = gy + oy;
          if (ny < 0 || ny >= H) continue;
          const nx = (gx + ox + W) % W,
            q = ny * W + nx;
          if (!water[q] || iceCell[q]) continue;
          const b = [nearX((nx + 0.5) * stepX, a[0]), (ny + 0.5) * stepY],
            ex = b[0] - a[0],
            ey = b[1] - a[1],
            el = Math.hypot(ex, ey) || 1;
          if (seaD(wrapX(b[0]), b[1]) >= 0) continue;
          let lo = 0,
            hi = 1;
          for (let j = 0; j < 16; j++) {
            const t = (lo + hi) * 0.5;
            if (seaD(wrapX(a[0] + ex * t), a[1] + ey * t) >= 0) lo = t;
            else hi = t;
          }
          const score = (ix * ex + iy * ey) / (il * el);
          if (!best || score > best.score) best = { score, b, ex, ey, hi };
        }
      if (best) {
        const t = best.hi,
          shore = [a[0] + best.ex * t, a[1] + best.ey * t],
          out = Math.min(
            1,
            t +
              Math.min(2, Math.hypot(best.ex, best.ey) * (1 - t)) /
                Math.max(1, Math.hypot(best.ex, best.ey)),
          );
        pts.push(shore, [a[0] + best.ex * out, a[1] + best.ey * out]);
      }
    }
    const drawPts = [];
    if (pts.length > 1) {
      const steps = 4;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)],
          p1 = pts[i],
          p2 = pts[i + 1],
          p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let j = 0; j < steps; j++) {
          const t = j / steps,
            t2 = t * t,
            t3 = t2 * t;
          drawPts.push([
            0.5 *
              (2 * p1[0] +
                (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 *
              (2 * p1[1] +
                (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ]);
        }
      }
      drawPts.push(pts[pts.length - 1]);
    }
    return { pts, drawPts };
  }
  function addDrainageRiver(src, minCells, width) {
    if (src < 0 || down[src] < 0) return false;
    const path = [];
    let cur = src,
      guard = 0;
    while (cur >= 0 && guard++ < N) {
      path.push(cur);
      if (riverCells[cur]) break;
      cur = down[cur];
    }
    if (path.length < minCells) return false;
    const sx = src % W,
      sy = (src / W) | 0,
      x = (sx + 0.5) * stepX,
      y = (sy + 0.5) * stepY,
      { pts, drawPts } = riverGeometry(path);
    sourcePts.push({ x, y });
    path.forEach((k) => (riverCells[k] = 1));
    rivers.push({
      pts,
      drawPts,
      w: width || 2,
      name: RIVER_NAMES[rivers.length % RIVER_NAMES.length],
    });
    return true;
  }
  for (const c of T.sea.continents) {
    const picks = [null, null, null, null],
      ca = Math.cos(c.a),
      sa = Math.sin(c.a);
    for (let k = 0; k < N; k++) {
      if (!land[k] || down[k] < 0) continue;
      const gx = k % W,
        gy = (k / W) | 0,
        x = (gx + 0.5) * stepX,
        y = (gy + 0.5) * stepY,
        dx = nearX(x, c.x) - c.x,
        dy = y - c.y,
        u = (dx * ca + dy * sa) / c.rx,
        v = (-dx * sa + dy * ca) / c.ry,
        r = Math.hypot(u, v);
      if (r > 0.94) continue;
      const q = (u >= 0 ? 1 : 0) + (v >= 0 ? 2 : 0),
        score = height[k] + (1 - r) * 0.035;
      if (!picks[q] || score > picks[q].score) picks[q] = { src: k, score, x, y };
    }
    let made = 0;
    for (const p of picks.filter(Boolean).sort((a, b) => b.score - a.score)) {
      if (sourcePts.some((q) => geoXY(p.x, p.y, q.x, q.y) < 300)) continue;
      if (addDrainageRiver(p.src, 4, 2.4)) made++;
      if (made >= 4) break;
    }
    if (!made) {
      let src = -1,
        best = -Infinity;
      for (let k = 0; k < N; k++) {
        if (!land[k] || down[k] < 0) continue;
        const gx = k % W,
          gy = (k / W) | 0,
          x = (gx + 0.5) * stepX,
          y = (gy + 0.5) * stepY,
          dx = nearX(x, c.x) - c.x,
          dy = y - c.y,
          u = (dx * ca + dy * sa) / c.rx,
          v = (-dx * sa + dy * ca) / c.ry,
          r = Math.hypot(u, v);
        if (r > 1.12) continue;
        const score = height[k] - (r - 0.94) * 0.08;
        if (score > best) {
          best = score;
          src = k;
        }
      }
      addDrainageRiver(src, 4, 2.4);
    }
  }
  for (let ci = 0; ci < main.length; ci++) {
    const candidates = main[ci].cells
      .filter((k) => height[k] >= 0.105)
      .sort((a, b) => height[b] - height[a]);
    let made = 0;
    for (let si = 0; si < candidates.length && made < quota[ci]; si++) {
      const src = candidates[si],
        sx = src % W,
        sy = (src / W) | 0,
        x = (sx + 0.5) * stepX,
        y = (sy + 0.5) * stepY;
      if (riverCells[src] || sourcePts.some((p) => geoXY(x, y, p.x, p.y) < 440)) continue;
      const path = [];
      let cur = src,
        guard = 0;
      while (cur >= 0 && guard++ < N) {
        path.push(cur);
        if (riverCells[cur]) break;
        cur = down[cur];
      }
      if (path.length < 6) continue;
      sourcePts.push({ x, y });
      path.forEach((k) => (riverCells[k] = 1));
      const { pts, drawPts } = riverGeometry(path);
      rivers.push({
        pts,
        drawPts,
        w: 1.2 + Math.min(2.5, path.length * 0.035),
        name: RIVER_NAMES[rivers.length % RIVER_NAMES.length],
      });
      made++;
    }
    // If this landmass has no high source above the normal threshold, route one from its highest interior point.
    if (!made) {
      const src = main[ci].cells.reduce(
        (best, k) => (best < 0 || height[k] > height[best] ? k : best),
        -1,
      );
      if (src >= 0 && down[src] >= 0) {
        const path = [];
        let cur = src,
          guard = 0;
        while (cur >= 0 && guard++ < N) {
          path.push(cur);
          if (riverCells[cur]) break;
          cur = down[cur];
        }
        if (path.length >= 6) {
          const { pts, drawPts } = riverGeometry(path);
          rivers.push({
            pts,
            drawPts,
            w: 2,
            name: RIVER_NAMES[rivers.length % RIVER_NAMES.length],
          });
          path.forEach((k) => (riverCells[k] = 1));
        }
      }
    }
  }
  T.rivers = rivers;
  T.lakes = lakes;
}
function nameGeoFeatures(T, rr, continentNameStyle) {
  const out = [],
    geoNames = geographicContinentNames(T.sea.continents.length, rr);
  T.sea.continents.forEach((c, i) =>
    out.push({
      kind: "continent",
      name:
        continentNameStyle === "fantasy"
          ? FANTASY_CONT_NAMES[i % FANTASY_CONT_NAMES.length]
          : geoNames[i],
      x: c.x,
      y: c.y,
    }),
  );
  const W = T.tectonics.W,
    H = T.tectonics.H,
    candidates = [];
  for (let gy = 2; gy < H - 2; gy += 2)
    for (let gx = 0; gx < W; gx += 2) {
      const x = ((gx + 0.5) * RW) / W,
        y = ((gy + 0.5) * RH) / H;
      if (T.tectonics.uplift[gy * W + gx] > 0.52 && seaD(x, y) > 0)
        candidates.push({ x, y, w: T.tectonics.uplift[gy * W + gx] });
    }
  candidates.sort((a, b) => b.w - a.w);
  const ranges = [];
  for (const p of candidates) {
    if (ranges.length >= 8) break;
    if (ranges.every((q) => geoXY(p.x, p.y, q.x, q.y) > 1450)) ranges.push(p);
  }
  ranges.forEach((p, i) =>
    out.push({ kind: "range", name: RANGE_NAMES[i % RANGE_NAMES.length], x: p.x, y: p.y }),
  );
  T.rivers.forEach((r, i) => {
    r.name = r.name || RIVER_NAMES[i % RIVER_NAMES.length];
    const p = r.pts[Math.floor(r.pts.length * 0.55)];
    if (p) out.push({ kind: "river", name: r.name, x: p[0], y: p[1] });
  });
  T.lakes.forEach((l, i) => {
    l.name = l.name || LAKE_NAMES[i % LAKE_NAMES.length];
    out.push({ kind: "lake", name: l.name, x: l.x, y: l.y });
  });
  out.push(
    { kind: "ice", name: "Северная ледяная шапка", x: RW * 0.5, y: RH * 0.045 },
    { kind: "ice", name: "Южная ледяная шапка", x: RW * 0.5, y: RH * 0.955 },
  );
  const oceans = [
    "Тихий океан",
    "Атлантический океан",
    "Восточный океан",
    "Море Дальних островов",
    "Южное море",
  ];
  for (let i = 0; i < oceans.length; i++) {
    let p = null;
    for (let t = 0; t < 80; t++) {
      const x = rr() * RW,
        y = RH * (0.18 + rr() * 0.64);
      if (seaD(x, y) < -250) {
        p = { x, y };
        break;
      }
    }
    if (p) out.push({ kind: "ocean", name: oceans[i], x: p.x, y: p.y });
  }
  T.geoFeatures = out;
}
function makePlanetLegacy(T, seed, count, continentNameStyle) {
  const rr = mulberry32((seed ^ 0x72a31e5d) >>> 0);
  count = clamp(Math.round(+count || 5), 1, 8);
  T.sea = { planet: true, continents: [] };
  T.continentCount = count;
  const layouts = {
      1: [[0.5, 0.5]],
      2: [
        [0.27, 0.45],
        [0.73, 0.56],
      ],
      3: [
        [0.16, 0.43],
        [0.5, 0.39],
        [0.84, 0.59],
      ],
      4: [
        [0.13, 0.41],
        [0.63, 0.38],
        [0.38, 0.62],
        [0.88, 0.59],
      ],
      5: [
        [0.1, 0.4],
        [0.43, 0.37],
        [0.79, 0.43],
        [0.27, 0.62],
        [0.68, 0.6],
      ],
      6: [
        [0.1, 0.41],
        [0.42, 0.37],
        [0.76, 0.43],
        [0.22, 0.61],
        [0.55, 0.63],
        [0.89, 0.58],
      ],
      7: [
        [0.09, 0.41],
        [0.34, 0.37],
        [0.63, 0.39],
        [0.88, 0.44],
        [0.22, 0.63],
        [0.51, 0.6],
        [0.78, 0.62],
      ],
      8: [
        [0.08, 0.42],
        [0.31, 0.37],
        [0.55, 0.39],
        [0.8, 0.44],
        [0.17, 0.62],
        [0.4, 0.63],
        [0.65, 0.6],
        [0.89, 0.62],
      ],
    },
    sites = layouts[count],
    longitudeOffset = rr() * RW,
    landArea = RW * RH * 0.36,
    xJitter = count <= 3 || count >= 7 ? 0.012 : 0.026,
    yJitter = count >= 4 ? 0.018 : 0.026,
    weights = sites.map(() => 0.72 + rr() * 0.56),
    lower = sites.map((p, i) => (p[1] > 0.5 ? i : -1)).filter((i) => i >= 0),
    major = count >= 4 && count <= 6 ? lower[Math.floor(rr() * lower.length)] : -1;
  if (major >= 0) weights[major] *= count === 4 ? 1.9 : 2.15;
  const weightTotal = weights.reduce((a, v) => a + v, 0),
    coastLimit = count === 1 ? 0.45 : count <= 3 ? 0.42 : count <= 6 ? 0.43 : 0.38;
  function coastProfile() {
    const size = 256,
      out = new Float32Array(size),
      waves = [],
      lobes = [],
      bays = [];
    for (let k = 2; k <= 5; k++) {
      const amp = { 2: 0.13, 3: 0.09, 4: 0.055, 5: 0.03 }[k] * (0.75 + rr() * 0.5);
      waves.push({ k, amp, p: rr() * Math.PI * 2 });
    }
    for (let j = 0, n = 2 + Math.floor(rr() * 3); j < n; j++) {
      const a = rr() * Math.PI * 2,
        d = 0.65 + rr() * 0.17,
        radial = j === 0 ? 0.44 + rr() * 0.2 : 0.34 + rr() * 0.2,
        tangent = j === 0 ? 0.18 + rr() * 0.15 : 0.17 + rr() * 0.21;
      lobes.push({ a, d, radial, tangent });
    }
    for (let j = 0, n = 1 + Math.floor(rr() * 3); j < n; j++)
      bays.push({
        a: rr() * Math.PI * 2,
        d: 0.78 + rr() * 0.16,
        radial: 0.36 + rr() * 0.17,
        tangent: 0.2 + rr() * 0.2,
      });
    function rayHit(a, q, entry) {
      const d = a - q.a,
        co = Math.cos(d),
        si = Math.sin(d),
        A = (co * co) / (q.radial * q.radial) + (si * si) / (q.tangent * q.tangent),
        B = (-2 * q.d * co) / (q.radial * q.radial),
        C = (q.d * q.d) / (q.radial * q.radial) - 1,
        disc = B * B - 4 * A * C;
      if (disc <= 0) return 0;
      return (-B + (entry ? -1 : 1) * Math.sqrt(disc)) / (2 * A);
    }
    const raw = new Float32Array(size),
      core = 0.78 + rr() * 0.14;
    for (let i = 0; i < size; i++) {
      const a = (i / size) * Math.PI * 2;
      let edge = core;
      for (const q of waves) edge += q.amp * Math.sin(q.k * a + q.p);
      for (const q of lobes) edge = Math.max(edge, rayHit(a, q, false));
      for (const q of bays) {
        const inner = rayHit(a, q, true);
        if (inner > 0 && inner < edge) edge = inner;
      }
      raw[i] = clamp(edge - 1, -coastLimit, coastLimit);
    }
    for (let i = 0; i < size; i++) {
      let v = 0;
      for (let k = -3; k <= 3; k++)
        v += raw[(i + k + size) % size] * ([1, 2, 3, 4, 3, 2, 1][k + 3] / 16);
      out[i] = v;
    }
    return out;
  }
  sites.forEach(([fx, fy], i) => {
    const x = wrapX((fx + (rr() - 0.5) * xJitter) * RW + longitudeOffset),
      y = RH * (fy + (rr() - 0.5) * yJitter),
      area = (landArea * weights[i]) / weightTotal,
      aspect = rr() < 0.24 ? 0.78 + rr() * 0.72 : 1.25 + Math.pow(rr(), 0.78) * 1.75,
      rx = Math.sqrt((area * aspect) / Math.PI),
      ry = Math.sqrt(area / (aspect * Math.PI)),
      waist =
        rr() < 0.27
          ? {
              a: rr() * Math.PI * 2,
              offset: 0.74 + rr() * 0.12,
              along: 0.48 + rr() * 0.12,
              across: 0.72 + rr() * 0.12,
            }
          : null;
    if (waist) {
      (waist as any).ca = Math.cos(waist.a);
      (waist as any).sa = Math.sin(waist.a);
    }
    T.sea.continents.push({
      x,
      y,
      rx,
      ry,
      a: rr() * Math.PI,
      waist,
      coastLimit,
      coastProfile: coastProfile(),
    });
  });
  function radialReach(c, angle) {
    const a = angle - c.a,
      ux = Math.cos(a) / c.rx,
      vy = Math.sin(a) / c.ry,
      r = 1 / Math.hypot(ux, vy),
      p = (Math.atan2(vy, ux) / (Math.PI * 2) + 1) % 1,
      at = p * c.coastProfile.length,
      i = Math.floor(at),
      f = at - i,
      rough =
        c.coastProfile[i] +
        (c.coastProfile[(i + 1) % c.coastProfile.length] - c.coastProfile[i]) * f;
    return r + Math.min(c.rx, c.ry) * rough;
  }
  let bridgePair = null;
  if (count >= 2 && rr() < (count === 2 ? 0.25 : 0.5)) {
    const pairs = [];
    for (let i = 0; i < T.sea.continents.length; i++)
      for (let j = i + 1; j < T.sea.continents.length; j++) {
        const a = T.sea.continents[i],
          b = T.sea.continents[j],
          dx = nearX(b.x, a.x) - a.x,
          dy = b.y - a.y;
        pairs.push({ i, j, dx, dy, d: Math.hypot(dx, dy) });
      }
    pairs.sort((a, b) => a.d - b.d);
    if (pairs.length) {
      const p = pairs[Math.floor(rr() * Math.min(3, pairs.length))],
        a = T.sea.continents[p.i],
        b = T.sea.continents[p.j],
        angle = Math.atan2(p.dy, p.dx),
        reach = radialReach(a, angle) + radialReach(b, angle + Math.PI),
        target = Math.max(250, reach - 120);
      if (p.d > target) {
        const f = target / p.d;
        b.x = wrapX(a.x + p.dx * f);
        b.y = clamp(a.y + p.dy * f, RH * 0.24, RH * 0.76);
      }
      bridgePair = p.i + ":" + p.j;
    }
  }
  const iceEdge = RH * ((90 - 66.5) / 180),
    oceanGap = 500;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const c of T.sea.continents) {
      let north = 0,
        south = 0;
      for (let k = 0; k < c.coastProfile.length; k++) {
        const a = (k / c.coastProfile.length) * Math.PI * 2,
          reach = radialReach(c, a),
          dy = reach * Math.sin(a);
        north = Math.max(north, -dy);
        south = Math.max(south, dy);
      }
      const northRoom = c.y - iceEdge - oceanGap,
        southRoom = RH - iceEdge - oceanGap - c.y,
        northScale = north > northRoom ? northRoom / north : 1,
        southScale = south > southRoom ? southRoom / south : 1,
        scale = Math.min(northScale, southScale);
      if (scale < 1) {
        const k = Math.max(0.68, scale * 0.985);
        c.rx *= k;
        c.ry *= k;
        changed = true;
      }
    }
    for (let i = 0; i < T.sea.continents.length; i++)
      for (let j = i + 1; j < T.sea.continents.length; j++) {
        const a = T.sea.continents[i],
          b = T.sea.continents[j],
          raw = b.x - a.x,
          dx = raw - Math.round(raw / RW) * RW,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d < 1) continue;
        const angle = Math.atan2(dy, dx),
          reach = radialReach(a, angle) + radialReach(b, angle + Math.PI);
        if (bridgePair !== i + ":" + j && reach + oceanGap > d) {
          const k = Math.max(0.68, ((d - oceanGap) / reach) * 0.985);
          a.rx *= k;
          a.ry *= k;
          b.rx *= k;
          b.ry *= k;
          changed = true;
        }
      }
    if (!changed) break;
  }
  buildTectonics(T, count, rr);
  buildBiomeGrid(T);
  T.biomeImg = makeBiomeImg(T);
  generateRivers(T, seed);
  nameGeoFeatures(T, rr, continentNameStyle);
}
export function makePlanet(T, seed, count, continentNameStyle, worldVersion) {
  if (worldVersion === 1) return makePlanetLegacy(T, seed, count, continentNameStyle);
  return makePlanetV2(T, seed, count, continentNameStyle);
}
function makePlanetV2(T, seed, count, continentNameStyle) {
  const rr = mulberry32((seed ^ 0x72a31e5d) >>> 0);
  count = clamp(Math.round(+count || 5), 1, 8);
  T.sea = { planet: true, continents: [] };
  T.continentCount = count;
  const landArea = RW * RH * 0.36,
    weights = Array.from({ length: count }, () => 0.55 + Math.pow(rr(), 1.3) * 1.25);
  const major = Math.floor(rr() * count);
  weights[major] *= 1.7 + rr() * 1.45;
  const weightTotal = weights.reduce((a, v) => a + v, 0),
    coastLimit = count === 1 ? 0.46 : count <= 3 ? 0.43 : count <= 6 ? 0.4 : 0.36;
  function coastProfile() {
    const size = 256,
      out = new Float32Array(size),
      raw = new Float32Array(size),
      waves = [],
      lobes = [],
      bays = [];
    for (let k = 1; k <= 13; k++) {
      const amp =
        (k === 1 ? 0.065 : k === 2 ? 0.085 : k === 3 ? 0.06 : k <= 6 ? 0.036 : 0.014) *
        (0.58 + rr() * 0.84);
      waves.push({ k, amp, p: rr() * Math.PI * 2 });
    }
    for (let j = 0, n = 1 + Math.floor(rr() * 4); j < n; j++)
      lobes.push({
        a: rr() * Math.PI * 2,
        d: 0.58 + rr() * 0.27,
        radial: 0.27 + rr() * 0.25,
        tangent: 0.075 + rr() * 0.16,
      });
    for (let j = 0, n = 2 + Math.floor(rr() * 4); j < n; j++)
      bays.push({
        a: rr() * Math.PI * 2,
        d: 0.73 + rr() * 0.2,
        radial: 0.28 + rr() * 0.26,
        tangent: 0.12 + rr() * 0.19,
      });
    function rayHit(a, q, entry) {
      const d = a - q.a,
        co = Math.cos(d),
        si = Math.sin(d),
        A = (co * co) / (q.radial * q.radial) + (si * si) / (q.tangent * q.tangent),
        B = (-2 * q.d * co) / (q.radial * q.radial),
        C = (q.d * q.d) / (q.radial * q.radial) - 1,
        disc = B * B - 4 * A * C;
      if (disc <= 0) return 0;
      return (-B + (entry ? -1 : 1) * Math.sqrt(disc)) / (2 * A);
    }
    const core = 0.74 + rr() * 0.17;
    for (let i = 0; i < size; i++) {
      const a = (i / size) * Math.PI * 2;
      let edge = core;
      for (const q of waves) edge += q.amp * Math.sin(q.k * a + q.p);
      for (const q of lobes) edge = Math.max(edge, rayHit(a, q, false));
      for (const q of bays) {
        const inner = rayHit(a, q, true);
        if (inner > 0 && inner < edge) edge = inner;
      }
      raw[i] = clamp(edge - 1, -coastLimit, coastLimit);
    }
    for (let i = 0; i < size; i++) {
      let v = 0;
      for (let k = -2; k <= 2; k++) v += raw[(i + k + size) % size] * ([1, 2, 3, 2, 1][k + 2] / 9);
      out[i] = v;
    }
    return out;
  }
  const shapes = [];
  for (let i = 0; i < count; i++) {
    const area = (landArea * weights[i]) / weightTotal,
      pick = rr(),
      aspect =
        pick < 0.22 ? 0.42 + rr() * 0.44 : pick < 0.82 ? 0.9 + rr() * 1.55 : 2.45 + rr() * 2.05;
    const rx = Math.sqrt((area * aspect) / Math.PI),
      ry = Math.sqrt(area / (aspect * Math.PI)),
      waist =
        rr() < 0.19
          ? {
              a: rr() * Math.PI * 2,
              offset: 0.72 + rr() * 0.15,
              along: 0.45 + rr() * 0.17,
              across: 0.68 + rr() * 0.2,
            }
          : null;
    if (waist) {
      (waist as any).ca = Math.cos(waist.a);
      (waist as any).sa = Math.sin(waist.a);
    }
    shapes.push({ rx, ry, a: rr() * Math.PI, waist, coastLimit, coastProfile: coastProfile() });
  }
  function randomY() {
    if (count === 1) return RH * (0.46 + (rr() - 0.5) * 0.08);
    const lat = ((rr() + rr() + rr() - 1.5) * 30.5 * Math.PI) / 180;
    return RH * (0.5 - lat / Math.PI);
  }
  for (let i = 0; i < count; i++) {
    const c = shapes[i],
      span = Math.max(c.rx, c.ry),
      need = [];
    let chosen = null,
      best = null,
      bestGap = -Infinity;
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = rr() * RW,
        y = randomY();
      let gap = Infinity;
      for (const other of T.sea.continents) {
        const d = geoXY(x, y, other.x, other.y);
        gap = Math.min(gap, d - (span + Math.max(other.rx, other.ry)) * 0.48 - 360);
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = { x, y };
      }
      if (gap >= 0) {
        chosen = { x, y };
        break;
      }
    }
    chosen = chosen || best || { x: rr() * RW, y: RH * 0.5 };
    Object.assign(c, chosen);
    c.x = wrapX(c.x);
    T.sea.continents.push(c);
  }
  function radialReach(c, angle) {
    const a = angle - c.a,
      ux = Math.cos(a) / c.rx,
      vy = Math.sin(a) / c.ry,
      r = 1 / Math.hypot(ux, vy),
      p = (Math.atan2(vy, ux) / (Math.PI * 2) + 1) % 1,
      at = p * c.coastProfile.length,
      i = Math.floor(at),
      f = at - i,
      rough =
        c.coastProfile[i] +
        (c.coastProfile[(i + 1) % c.coastProfile.length] - c.coastProfile[i]) * f;
    return r * (1 + rough);
  }
  let bridgePair = null;
  if (count >= 2 && rr() < (count === 2 ? 0.24 : 0.28)) {
    let pair = null;
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const a = T.sea.continents[i],
          b = T.sea.continents[j],
          d = geoXY(a.x, a.y, b.x, b.y);
        if (!pair || d < pair.d) pair = { i, j, d };
      }
    if (pair) {
      const a = T.sea.continents[pair.i],
        b = T.sea.continents[pair.j],
        dx = nearX(b.x, a.x) - a.x,
        dy = b.y - a.y,
        angle = Math.atan2(dy, dx),
        reach = radialReach(a, angle) + radialReach(b, angle + Math.PI),
        target = Math.max(250, reach - 180);
      if (pair.d > target) {
        const f = target / pair.d;
        b.x = wrapX(a.x + dx * f);
        b.y = clamp(a.y + dy * f, RH * 0.17, RH * 0.83);
      }
      bridgePair = pair.i + ":" + pair.j;
    }
  }
  const iceEdge = RH * ((90 - 66.5) / 180),
    oceanGap = 440;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const c of T.sea.continents) {
      let north = 0,
        south = 0;
      for (let k = 0; k < c.coastProfile.length; k++) {
        const a = (k / c.coastProfile.length) * Math.PI * 2,
          reach = radialReach(c, a),
          dy = reach * Math.sin(a);
        north = Math.max(north, -dy);
        south = Math.max(south, dy);
      }
      const northRoom = Math.max(100, c.y - iceEdge - oceanGap),
        southRoom = Math.max(100, RH - iceEdge - oceanGap - c.y),
        scale = Math.min(1, north ? northRoom / north : 1, south ? southRoom / south : 1);
      if (scale < 0.999) {
        const f = Math.max(0.58, scale * 0.985);
        c.rx *= f;
        c.ry *= f;
        changed = true;
      }
    }
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const a = T.sea.continents[i],
          b = T.sea.continents[j],
          dx = nearX(b.x, a.x) - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d < 1) continue;
        const pair = i + ":" + j,
          angle = Math.atan2(dy, dx),
          reach = radialReach(a, angle) + radialReach(b, angle + Math.PI);
        if (pair !== bridgePair && reach + oceanGap > d) {
          const f = Math.max(0.58, ((d - oceanGap) / reach) * 0.985);
          a.rx *= f;
          a.ry *= f;
          b.rx *= f;
          b.ry *= f;
          changed = true;
        }
      }
    if (!changed) break;
  }
  buildTectonics(T, count, rr);
  buildBiomeGrid(T);
  T.biomeImg = makeBiomeImg(T);
  generateRivers(T, seed);
  nameGeoFeatures(T, rr, continentNameStyle);
}
export function makeWorld2(T, seed) {
  const r2 = mulberry32((seed ^ 0x5bd1e995) >>> 0),
    bi = Math.floor(r2() * 4);
  T.biome = ["лесостепь", "тайга", "степь", "смешанные леса"][bi];
  T.fOff2 = [0, 0.1, -0.13, 0.05][bi];
  T.sOff2 = [0.03, -0.12, 0.1, -0.03][bi];
  if (r2() < 0.6) {
    const side = [1, 2, 3][Math.floor(r2() * 3)];
    T.sea = { side, depth: 60 + r2() * 110 };
  }
  if (r2() < 0.55) {
    const vert = r2() < 0.5,
      pts = [];
    let a = vert ? RW * (0.15 + r2() * 0.7) : RH * (0.15 + r2() * 0.7),
      d = 0;
    for (let t = -20; t <= (vert ? RH : RW) + 20; t += 40) {
      d = d * 0.5 + (r2() - 0.5) * 40;
      a += d;
      pts.push(vert ? [a, t] : [t, a]);
    }
    T.ridge = { pts, w: 22 + r2() * 26 };
  }
  if (r2() < 0.45) {
    const pts = [];
    let x = RW * (0.2 + r2() * 0.6),
      y = -8,
      dx = 0;
    while (y < RH + 8) {
      dx = dx * 0.6 + (r2() - 0.5) * 12;
      x = clamp(x + dx, 10, RW - 10);
      y += 10;
      pts.push([x, y]);
    }
    T.rivers.push({ pts, w: 0.3 });
  }
  const nl = r2() < 0.3 ? 8 + Math.floor(r2() * 10) : Math.floor(r2() * 4),
    lc = { x: 40 + r2() * (RW - 80), y: 40 + r2() * (RH - 80) };
  for (let q = 0; q < nl; q++)
    T.lakes.push(
      nl > 7
        ? {
            x: clamp(lc.x + (r2() - 0.5) * 120, 20, RW - 20),
            y: clamp(lc.y + (r2() - 0.5) * 90, 20, RH - 20),
            r: 1 + r2() * 3.5,
          }
        : { x: 30 + r2() * (RW - 60), y: 30 + r2() * (RH - 60), r: 2 + r2() * 6 },
    );
}
export function worldText() {
  const T = S.T,
    p = [];
  if (S.planet) p.push("планета, континентов: " + S.continentCount + ", полярные ледники");
  if (T.biome) p.push(T.biome);
  if (T.sea && !T.sea.planet)
    p.push("море на " + ["севере", "востоке", "юге", "западе"][T.sea.side]);
  if (T.ridge) p.push("горный хребет");
  return p.join(", ");
}
