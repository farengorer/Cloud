/**
 * Векторные границы между регионами.
 *
 * Карта регионов хранится растром (одна клетка растра около 28 км). Если рисовать границу
 * по краю клеток, она получается ступенчатой и на крупном плане толщиной в целую клетку.
 * Здесь граница собирается из рёбер между клетками в ломаные линии, у которых сглаживаются
 * внутренние вершины. Узлы, где сходятся три региона, и точки у береговой линии остаются
 * на месте, поэтому регионы не «расплываются».
 */

export interface BorderLine {
  /** Координаты x, y, x, y… в тех же единицах, что и карта мира (км). */
  pts: Float32Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 — между двумя свободными регионами, 1 — свободный и присоединённый, 2 — между присоединёнными. */
  kind: 0 | 1 | 2;
  /** Для kind = 1: номер присоединённого региона, иначе -1. */
  owner: number;
}

const SMOOTH_PASSES = 4;
const OWNER_RANGE = 1048576;

export function buildBorders(
  cell: Int32Array,
  W: number,
  H: number,
  worldW: number,
  worldH: number,
  regionOf: (id: number) => number,
): BorderLine[] {
  const vid = (i: number, j: number) => j * W + (((i % W) + W) % W);
  const nbrs = new Map<number, number[]>();
  const edgeInfo = new Map<number, number>(); // ключ ребра -> kind * OWNER_RANGE + (owner + 1)
  const fixed = new Set<number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * 2097152 + b : b * 2097152 + a);

  const regionCache = new Map<number, number>();
  const region = (id: number) => {
    let r = regionCache.get(id);
    if (r === undefined) {
      r = regionOf(id);
      regionCache.set(id, r);
    }
    return r;
  };
  const addEdge = (a: number, b: number, A: number, B: number) => {
    const rA = region(A),
      rB = region(B);
    if (rA >= 0 && rA === rB) return; // клетки одного региона
    let kind = 0,
      owner = -1;
    if (rA >= 0 && rB >= 0) kind = 2;
    else if (rA >= 0 || rB >= 0) {
      kind = 1;
      owner = rA >= 0 ? rA : rB;
    }
    const k = edgeKey(a, b);
    if (edgeInfo.has(k)) return;
    edgeInfo.set(k, kind * OWNER_RANGE + owner + 1);
    (nbrs.get(a) || nbrs.set(a, []).get(a)!).push(b);
    (nbrs.get(b) || nbrs.set(b, []).get(b)!).push(a);
  };

  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const A = cell[gy * W + gx];
      const right = cell[gy * W + ((gx + 1) % W)];
      if (A >= 0 && right >= 0 && A !== right)
        addEdge(vid(gx + 1, gy), vid(gx + 1, gy + 1), A, right);
      else if (A >= 0 !== right >= 0) {
        fixed.add(vid(gx + 1, gy));
        fixed.add(vid(gx + 1, gy + 1));
      }
      if (gy + 1 < H) {
        const down = cell[(gy + 1) * W + gx];
        if (A >= 0 && down >= 0 && A !== down)
          addEdge(vid(gx, gy + 1), vid(gx + 1, gy + 1), A, down);
        else if (A >= 0 !== down >= 0) {
          fixed.add(vid(gx, gy + 1));
          fixed.add(vid(gx + 1, gy + 1));
        }
      }
    }
  }

  // Позиции вершин в координатах клеток растра.
  const pos = new Map<number, [number, number]>();
  for (const v of nbrs.keys()) pos.set(v, [v % W, Math.floor(v / W)]);
  const near = (x: number, ref: number) => {
    if (x - ref > W / 2) return x - W;
    if (x - ref < -W / 2) return x + W;
    return x;
  };
  const movable: number[] = [];
  for (const [v, list] of nbrs) if (list.length === 2 && !fixed.has(v)) movable.push(v);
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Map<number, [number, number]>();
    for (const v of movable) {
      const p = pos.get(v)!,
        a = pos.get(nbrs.get(v)![0])!,
        b = pos.get(nbrs.get(v)![1])!;
      next.set(v, [
        0.5 * p[0] + 0.25 * (near(a[0], p[0]) + near(b[0], p[0])),
        0.5 * p[1] + 0.25 * (a[1] + b[1]),
      ]);
    }
    for (const [v, p] of next) pos.set(v, p);
  }

  // Сборка ломаных от узлов до узлов, затем замкнутые контуры.
  const lines: BorderLine[] = [];
  const used = new Set<number>();
  const isNode = (v: number) => fixed.has(v) || nbrs.get(v)!.length !== 2;
  const emit = (chain: number[]) => {
    const xy = new Float32Array(chain.length * 2),
      kx = worldW / W,
      ky = worldH / H;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      prevX = 0;
    chain.forEach((v, n) => {
      const p = pos.get(v)!;
      const x = n === 0 ? p[0] : near(p[0], prevX);
      prevX = x;
      const wx = x * kx,
        wy = p[1] * ky;
      xy[n * 2] = wx;
      xy[n * 2 + 1] = wy;
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy;
      if (wy > y1) y1 = wy;
    });
    const info = edgeInfo.get(edgeKey(chain[0], chain[1]))!;
    lines.push({
      pts: xy,
      x0,
      y0,
      x1,
      y1,
      kind: Math.floor(info / OWNER_RANGE) as 0 | 1 | 2,
      owner: (info % OWNER_RANGE) - 1,
    });
  };
  const walk = (start: number, first: number) => {
    const chain = [start, first];
    used.add(edgeKey(start, first));
    let prev = start,
      cur = first;
    while (!isNode(cur) && cur !== start) {
      const options = nbrs.get(cur)!,
        next = options[0] === prev ? options[1] : options[0];
      if (used.has(edgeKey(cur, next))) break;
      used.add(edgeKey(cur, next));
      chain.push(next);
      prev = cur;
      cur = next;
    }
    emit(chain);
  };
  for (const [v, list] of nbrs) {
    if (!isNode(v)) continue;
    for (const u of list) if (!used.has(edgeKey(v, u))) walk(v, u);
  }
  for (const [v, list] of nbrs) for (const u of list) if (!used.has(edgeKey(v, u))) walk(v, u);
  return lines;
}
