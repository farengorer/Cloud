import { describe, expect, it } from "vitest";
import { TILE, prepareBase, renderTile, terrainAt, type ReliefBase } from "../src/relief/render";
import { ridged } from "../src/relief/noise";

const WORLD_W = 40075,
  WORLD_H = 20004;

/** Игровой растр высот для проверок: три острова, один из них лежит на шве карты. */
function makeBase(anchors: number[] = []): ReliefBase {
  const W = 1024,
    H = 512,
    K = WORLD_W / W,
    E = new Float32Array(W * H),
    SD = new Float32Array(W * H),
    islands = [
      { x: 10000, y: 9000, r: 3200 },
      { x: 28000, y: 11000, r: 4200 },
      { x: 0, y: 10000, r: 3500 },
    ];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const wx = i * K,
        wy = j * K;
      let sd = -400;
      for (const o of islands) {
        let dx = Math.abs(wx - o.x);
        if (dx > WORLD_W / 2) dx = WORLD_W - dx;
        sd = Math.max(sd, o.r - Math.hypot(dx, wy - o.y));
      }
      SD[j * W + i] = sd;
      E[j * W + i] = sd > 0 ? Math.min(1, sd / 2800) * 0.8 : 0;
    }
  return {
    W,
    H,
    E,
    SD,
    biomeW: 4,
    biomeH: 2,
    biome: new Uint8Array([3, 3, 4, 7, 2, 3, 5, 1]),
    seed: 12345,
    worldW: WORLD_W,
    worldH: WORLD_H,
    anchors,
  };
}

const mean = (px: Uint8ClampedArray) => {
  const m = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) m[c] += px[i + c];
  return m.map((v) => v / (px.length / 4));
};

describe("печатный рельеф: ядро плитки", () => {
  const base = prepareBase(makeBase());

  it("плитка детерминирована и полностью непрозрачна", () => {
    const a = renderTile(base, 2, 1, 1),
      b = renderTile(base, 2, 1, 1);
    expect(a.length).toBe(TILE * TILE * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it("шум хребтов даёт значения 0..1 и не зависит от порядка вызовов", () => {
    const v1 = ridged(1000, 2000, 3000, 7, 1),
      v2 = ridged(1000, 2000, 3000, 7, 1);
    expect(v1).toBe(v2);
    for (let i = 0; i < 200; i++) {
      const v = ridged(i * 137, i * 71, i * 29, 7, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("шва по долготе нет: крайние колонки соседних плиток похожи", () => {
    // остров лежит на нуле долготы, значит левая и правая плитки показывают сушу
    const L = 3,
      cols = 2 ** (L + 1),
      ty = 2,
      left = renderTile(base, L, 0, ty),
      right = renderTile(base, L, cols - 1, ty);
    let diff = 0,
      n = 0,
      across = 0;
    for (let y = 0; y < TILE; y++) {
      const a = y * TILE * 4,
        b = (y * TILE + TILE - 1) * 4,
        mid = (y * TILE + 128) * 4;
      for (let c = 0; c < 3; c++) {
        diff += Math.abs(left[a + c] - right[b + c]);
        across += Math.abs(left[a + c] - left[mid + c]);
        n++;
      }
    }
    // соседние через шов пиксели различаются не сильнее, чем пиксели внутри плитки
    expect(diff / n).toBeLessThan(18);
    expect(diff / n).toBeLessThan(across / n + 6);
  });

  it("города остаются на суше, даже если детали берега отодвинули бы воду", () => {
    const pts: number[] = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      pts.push(10000 + (3200 - 2.5) * Math.cos(a), 9000 + (3200 - 2.5) * Math.sin(a));
    }
    const without = prepareBase(makeBase()),
      withCities = prepareBase(makeBase(pts));
    let wet = 0,
      wetWith = 0;
    for (let k = 0; k < pts.length; k += 2) {
      if (terrainAt(without, pts[k], pts[k + 1], 1).sd < 0) wet++;
      if (terrainAt(withCities, pts[k], pts[k + 1], 1).sd < 0) wetWith++;
    }
    expect(wet).toBeGreaterThan(3); // без защиты детали действительно съедают берег
    expect(wetWith).toBe(0);
  });

  it("при смене масштаба цвет плитки почти не меняется", () => {
    const parent = mean(renderTile(base, 3, 5, 3)),
      kids = [0, 1].flatMap((dy) => [0, 1].map((dx) => mean(renderTile(base, 4, 10 + dx, 6 + dy)))),
      avg = [0, 1, 2].map((c) => kids.reduce((a, k) => a + k[c], 0) / 4);
    for (let c = 0; c < 3; c++) expect(Math.abs(parent[c] - avg[c])).toBeLessThan(14);
  });

  it("у полюса лежит лёд, в океане вода, на острове рельеф с перепадами яркости", () => {
    const pole = mean(renderTile(base, 3, 4, 0));
    expect(pole[0]).toBeGreaterThan(140);
    expect(pole[2]).toBeGreaterThan(190);
    const sea = mean(renderTile(base, 3, 9, 6));
    expect(sea[2]).toBeGreaterThan(sea[0] + 30); // синее красного
    const land = renderTile(base, 5, 17, 11);
    let lo = 255,
      hi = 0;
    for (let i = 0; i < land.length; i += 4) {
      const l = (land[i] + land[i + 1] + land[i + 2]) / 3;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    expect(hi - lo).toBeGreaterThan(40);
  });

  it("плитка считается за разумное время", () => {
    const t0 = performance.now();
    renderTile(base, 5, 17, 11);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
