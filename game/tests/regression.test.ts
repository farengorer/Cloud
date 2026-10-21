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
      for (const [dx, dy] of [
        [60, 0],
        [-60, 0],
        [0, 60],
        [0, -60],
        [90, 90],
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
