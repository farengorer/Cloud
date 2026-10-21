import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, f), "utf8");
// Обычная партия сверяется с исходной версией, планета и территория — с собственным эталоном
// (эти правила менялись намеренно, см. tests/capture-planet.mjs).
const goldenClassic = JSON.parse(read("golden.json"));
const goldenPlanet = JSON.parse(read("golden-planet.json"));
const golden = { ...goldenClassic, ...goldenPlanet };

let server: ViteDevServer;
let browser: Browser;
let page: Page;
let url: string;
const pageErrors: string[] = [];

// Каждая страница получает фиксированные случайность и время и набор сценариев.
async function openGame(): Promise<Page> {
  const pg = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  pg.on("pageerror", (e) => pageErrors.push(e.message));
  await pg.addInitScript(read("seed-env.js"));
  await pg.addInitScript(read("state-hash.js"));
  await pg.addInitScript(read("scenarios.js"));
  // Шрифты Google грузятся с внешнего хоста: не ждём события load, достаточно DOM.
  await pg.goto(url, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => (window as any).__hook, null, { timeout: 60000 });
  return pg;
}

beforeAll(async () => {
  server = await createServer({
    root: path.join(here, ".."),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  page = await openGame();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("загрузка", () => {
  it("страница стартует без ошибок JS", () => {
    expect(pageErrors).toEqual([]);
  });

  it("показывает главное меню", async () => {
    expect(await page.locator("#startPanel").isVisible()).toBe(true);
    expect(await page.locator("#menuNew").isVisible()).toBe(true);
  });
});

describe("симуляция совпадает с эталоном", () => {
  let result: Record<string, any>;
  beforeAll(async () => {
    // Результат сценария зависит от того, что игра считала раньше в этой же странице
    // (так устроена и исходная версия), поэтому наборы идут в отдельных свежих страницах.
    result = {};
    for (const which of ["classic", "planet"]) {
      const pg = await openGame();
      Object.assign(result, await pg.evaluate((w) => (window as any).__runScenarios(w), which));
      await pg.close();
    }
  });

  for (const key of Object.keys(golden)) {
    it(`сценарий ${key} (${key in goldenClassic ? "исходник" : "эталон планеты"})`, () => {
      if (golden[key] && golden[key].__all !== undefined) {
        // подробный разбор: какие поля состояния разошлись
        const diff = Object.keys(golden[key]).filter((k) => golden[key][k] !== result[key][k]);
        expect(diff).toEqual([]);
      } else {
        expect(result[key]).toEqual(golden[key]);
      }
    });
  }
});

describe("интерфейс", () => {
  it("новая игра создаёт планету и предлагает выбрать место", async () => {
    await page.reload();
    await page.waitForFunction(() => (window as any).__hook);
    await page.click("#menuNew");
    await page.click("#stGo");
    await page.waitForSelector("#startCityPicker:not([hidden])", { timeout: 60000 });
    await page.click("#startCitySuggested");
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>("#play")!.disabled,
      null,
      { timeout: 60000 },
    );
    await page.click("#step");
    expect(await page.locator("#play").textContent()).toBeTruthy();
    expect(pageErrors).toEqual([]);
  });

  it("новая игра: один стартовый регион, карта версии 4", async () => {
    const info = await page.evaluate(() => {
      const S = (window as any).__hook.S(),
        a = S.adminMap;
      return {
        version: a.version,
        regions: S.regions.length,
        cellsInFirst: S.regions[0].districts.length,
        startArea: S.regions[0].districts.reduce((t: number, id: number) => t + a.area[id], 0),
        cities: S.cities.length,
        cityRegion: S.cities.map((c: any) => S.districtById.get(c.districtId)?.regionId),
      };
    });
    expect(info.version).toBe(4);
    expect(info.regions).toBe(1);
    expect(info.cellsInFirst).toBe(1);
    expect(info.startArea).toBeGreaterThan(15000);
    expect(info.cityRegion.every((r: number) => r === 0)).toBe(true);
  });

  it("регион: цена 50 млрд + 1 млрд за 100 км, окно и присоединение", async () => {
    const info = await page.evaluate(() => {
      const h = (window as any).__hook,
        S = h.S(),
        c = S.cities[0];
      S.budget = 1000;
      let id = -1;
      for (const [dx, dy] of [
        [120, 0],
        [-120, 0],
        [0, 120],
        [0, -120],
        [130, 110],
        [-120, 110],
        [240, 0],
        [0, 240],
      ]) {
        const d = h.districtAt(c.x + dx, c.y + dy);
        if (d >= 0 && !S.districtById.has(d)) {
          id = d;
          break;
        }
      }
      if (id < 0) return null;
      const q = h.regionClaimCost(id);
      return { id, base: q.base, step: q.step, cost: q.cost, km: q.near ? q.near.km : null };
    });
    expect(info).not.toBeNull();
    expect(info!.base).toBe(50);
    expect(info!.step).toBe(100);
    expect(info!.cost).toBe(50 + Math.ceil((info!.km ?? 0) / 100));
    // клик по свободному региону открывает окно с ценой
    await page.evaluate(({ id }) => {
      const h = (window as any).__hook,
        S = h.S(),
        a = S.adminMap,
        q = a.points[id];
      const gx = q % a.W,
        gy = (q / a.W) | 0;
      h.openDistrictPopup(((gx + 0.5) * 40075) / a.W, ((gy + 0.5) * 20004) / a.H, {
        clientX: 200,
        clientY: 200,
      });
    }, info!);
    const popup = page.locator("#territoryPopup");
    expect(await popup.isVisible()).toBe(true);
    expect(await popup.textContent()).toContain("Свободный регион");
    expect(await popup.textContent()).toContain("100 км");
    const before = await page.evaluate(() => (window as any).__hook.S().budget);
    const regionsBefore = await page.evaluate(() => (window as any).__hook.S().regions.length);
    await page.click("[data-district-claim]");
    const after = await page.evaluate(({ id }) => {
      const S = (window as any).__hook.S(),
        d = S.districtById.get(id);
      return {
        owned: !!d,
        budget: S.budget,
        regions: S.regions.length,
        cells: d ? S.regions[d.regionId].districts.length : 0,
      };
    }, info!);
    expect(after.owned).toBe(true);
    expect(before - after.budget).toBeCloseTo(info!.cost, 6);
    expect(after.regions).toBe(regionsBefore + 1); // каждый присоединённый регион новый
    expect(after.cells).toBe(1);
    expect(await popup.textContent()).toContain("Регион «");
    expect(pageErrors).toEqual([]);
  });

  it("границы регионов: векторные линии без пустых значений", async () => {
    const stat = await page.evaluate(() => {
      const h = (window as any).__hook;
      h.render();
      const groups = h.DIST.borderGroups as any[];
      let lines = 0,
        points = 0,
        bad = 0;
      for (const g of groups)
        for (const l of g.lines) {
          lines++;
          points += l.pts.length / 2;
          for (let i = 0; i < l.pts.length; i++) if (!Number.isFinite(l.pts[i])) bad++;
        }
      return { groups: groups.length, lines, points, bad, owned: groups.some((g) => g.kind === 1) };
    });
    expect(stat.lines).toBeGreaterThan(50);
    expect(stat.bad).toBe(0);
    expect(stat.owned).toBe(true);
  });

  it("печатный рельеф: плитки готовы, карта не пустая, настройка переключает вид", async () => {
    await page.evaluate(() => {
      (window as any).__hook.init(321, {
        planet: true,
        capName: "Атлас",
        cultureId: "RU",
        continentCount: 5,
        continentNameStyle: "geographic",
        foreignCount: 0,
      });
      document.getElementById("startPanel")!.hidden = true;
    });
    await page.waitForFunction(
      () => {
        const st = (window as any).__hook.reliefStats();
        return st.ready && st.pending === 0 && st.inflight === 0 && st.cached >= 10;
      },
      null,
      { timeout: 60000 },
    );
    const sample = () =>
      page.evaluate(() => {
        (window as any).__hook.render();
        const cv = document.querySelector<HTMLCanvasElement>("#region")!,
          ctx = cv.getContext("2d")!;
        let sum = 0,
          sum2 = 0,
          n = 0,
          hash = 0;
        for (let y = 20; y < cv.height - 20; y += 40)
          for (let x = 20; x < cv.width - 20; x += 40) {
            const d = ctx.getImageData(x, y, 1, 1).data,
              l = (d[0] + d[1] + d[2]) / 3;
            sum += l;
            sum2 += l * l;
            n++;
            hash = (hash * 31 + d[0] * 3 + d[1] * 5 + d[2] * 7) | 0;
          }
        const mean = sum / n;
        return { std: Math.sqrt(sum2 / n - mean * mean), hash };
      });
    const stats = await page.evaluate(() => (window as any).__hook.reliefStats());
    expect(stats.workers > 0 || stats.fallback).toBe(true);
    const on = await sample();
    expect(on.std).toBeGreaterThan(4);
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("#appRelief")!;
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    });
    const off = await sample();
    expect(off.hash).not.toBe(on.hash); // без рельефа карта выглядит иначе
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("#appRelief")!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    });
    expect((await sample()).hash).toBe(on.hash);
    expect(pageErrors).toEqual([]);
  });

  it("основание города не сбрасывает печатный рельеф", async () => {
    await page.evaluate(() => {
      const h = (window as any).__hook;
      h.init(321, {
        planet: true,
        capName: "Атлас",
        cultureId: "RU",
        continentCount: 5,
        continentNameStyle: "geographic",
        foreignCount: 0,
      });
      document.getElementById("startPanel")!.hidden = true;
      const c = h.S().cities[0];
      h.V.z = 8;
      h.V.cx = c.x;
      h.V.cy = c.y;
      h.render();
    });
    const settle = () =>
      page.waitForFunction(
        () => {
          const st = (window as any).__hook.reliefStats();
          return st.ready && st.pending === 0 && st.inflight === 0 && st.cached >= 10;
        },
        null,
        { timeout: 60000 },
      );
    await settle();
    const before = await page.evaluate(() => (window as any).__hook.reliefStats());
    expect(before.coarse).toBe(true);
    const founded = await page.evaluate(() => {
      const h = (window as any).__hook,
        S = h.S(),
        c = S.cities[0];
      S.budget = 800;
      const n0 = S.cities.length;
      for (const [dx, dy] of [
        [150, 40],
        [-150, 40],
        [60, 160],
        [-80, -140],
        [40, 60],
        [90, 90],
      ]) {
        h.found(c.x + dx, c.y + dy);
        if (S.cities.length > n0) break;
      }
      h.render();
      return S.cities.length - n0;
    });
    expect(founded).toBe(1);
    await settle();
    const after = await page.evaluate(() => (window as any).__hook.reliefStats());
    expect(after.coarse).toBe(true); // крупные плитки на месте, карта не вернулась к старой картинке
    // и картинка по-прежнему печатная, а не прежняя: отличается от неё и не пустая
    const sample = () =>
      page.evaluate(() => {
        (window as any).__hook.render();
        const cv = document.querySelector<HTMLCanvasElement>("#region")!,
          ctx = cv.getContext("2d")!;
        let hash = 0,
          sum = 0,
          sum2 = 0,
          n = 0;
        for (let y = 20; y < cv.height - 20; y += 40)
          for (let x = 20; x < cv.width - 20; x += 40) {
            const d = ctx.getImageData(x, y, 1, 1).data,
              l = (d[0] + d[1] + d[2]) / 3;
            sum += l;
            sum2 += l * l;
            n++;
            hash = (hash * 31 + d[0] * 3 + d[1] * 5 + d[2] * 7) | 0;
          }
        const mean = sum / n;
        return { hash, std: Math.sqrt(sum2 / n - mean * mean) };
      });
    const on = await sample();
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("#appRelief")!;
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    });
    const off = await sample();
    await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("#appRelief")!;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    });
    expect(on.hash).not.toBe(off.hash);
    expect(on.std).toBeGreaterThan(4);
    expect(pageErrors).toEqual([]);
  });

  it("сохранение и загрузка сохраняют регионы", async () => {
    const before = await page.evaluate(() => {
      const S = (window as any).__hook.S();
      return {
        regions: S.regions.length,
        districts: S.districts.length,
        budget: S.budget,
        ruralPool: S.ruralPool,
      };
    });
    const after = await page.evaluate(async () => {
      const h = (window as any).__hook;
      await h.saveGame("solo");
      await h.loadSave("solo");
      const S = h.S();
      return {
        regions: S.regions.length,
        districts: S.districts.length,
        budget: S.budget,
        ruralPool: S.ruralPool,
        perRegion: S.regions.map((r: any) => r.districts.length),
      };
    });
    expect(after.regions).toBe(before.regions);
    expect(after.districts).toBe(before.districts);
    expect(after.ruralPool).toBeCloseTo(before.ruralPool, 0);
    expect(after.perRegion.every((n: number) => n === 1)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it("аэропорт: уровни и редактирование названия и кода", async () => {
    await page.evaluate(() => {
      const h = (window as any).__hook,
        S = h.S();
      S.budget = 500;
      h.doAct(S.cities[0], "air");
      h.doAct(S.cities[0], "airUpgrade");
      h.render();
    });
    const level = await page.evaluate(() => (window as any).__hook.S().cities[0].airLevel);
    expect(level).toBe(2);
    await page.fill("#airportNameInput", "Международный аэропорт");
    await page.fill("#airportCodeInput", "tst");
    await page.click("[data-airport-save]");
    const saved = await page.evaluate(() => {
      const c = (window as any).__hook.S().cities[0];
      return { name: c.airportName, code: c.airportCode };
    });
    expect(saved).toEqual({ name: "Международный аэропорт", code: "TST" });
    // неверный код отвергается
    await page.fill("#airportCodeInput", "12");
    await page.click("[data-airport-save]");
    expect(await page.locator("#airportIdentity [role=status]").textContent()).toContain(
      "трёх латинских букв",
    );
    expect(pageErrors).toEqual([]);
  });

  it("старая карта районов (версия 3) по-прежнему работает", async () => {
    const info = await page.evaluate(() => {
      const h = (window as any).__hook;
      h.init(5150, {
        planet: true,
        adminMapVersion: 3,
        capName: "Старая",
        cultureId: "RU",
        continentCount: 3,
        continentNameStyle: "geographic",
        foreignCount: 0,
      });
      const S = h.S(),
        c = S.cities[0];
      let free = -1;
      for (let r = 40; r <= 400 && free < 0; r += 40)
        for (const [dx, dy] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
          [r, r],
          [-r, r],
        ]) {
          const d = h.districtAt(c.x + dx, c.y + dy);
          if (d >= 0 && !S.districtById.has(d)) {
            free = d;
            break;
          }
        }
      const q = free >= 0 ? h.regionClaimCost(free) : null;
      for (let i = 0; i < 12; i++) h.stepMonth();
      return {
        version: S.adminMap.version,
        regions: S.regions.length,
        cells: S.regions[0].districts.length,
        base: q && q.base,
        step: q && q.step,
      };
    });
    expect(info.version).toBe(3);
    expect(info.regions).toBe(1);
    expect(info.cells).toBe(5);
    expect(info.base).toBe(15);
    expect(info.step).toBe(10);
    expect(pageErrors).toEqual([]);
  });
});
