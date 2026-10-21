import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, f), "utf8");
const golden = JSON.parse(read("golden.json"));

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

beforeAll(async () => {
  server = await createServer({
    root: path.join(here, ".."),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "error",
  });
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.addInitScript(read("seed-env.js"));
  await page.addInitScript(read("state-hash.js"));
  await page.addInitScript(read("scenarios.js"));
  // Шрифты Google грузятся с внешнего хоста: не ждём события load, достаточно DOM.
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any).__hook, null, { timeout: 60000 });
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

describe("симуляция совпадает с исходной версией", () => {
  let result: Record<string, any>;
  beforeAll(async () => {
    result = await page.evaluate(() => (window as any).__runScenarios());
  });

  for (const key of Object.keys(golden)) {
    it(`сценарий ${key}`, () => {
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

  it("район на карте территории: окно, присоединение за деньги", async () => {
    const info = await page.evaluate(() => {
      const h = (window as any).__hook,
        S = h.S(),
        c = S.cities[0];
      S.budget = 500;
      let id = -1;
      for (const [dx, dy] of [
        [30, 0],
        [-30, 0],
        [0, 30],
        [0, -30],
        [60, 60],
        [-60, 60],
        [90, 0],
        [0, 90],
        [-90, -90],
        [150, 0],
      ]) {
        const d = h.districtAt(c.x + dx, c.y + dy);
        if (d >= 0 && !S.districtById.has(d)) {
          id = d;
          break;
        }
      }
      if (id < 0) return null;
      return { id };
    });
    expect(info).not.toBeNull();
    // клик по свободному району открывает окно с ценой присоединения
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
    expect(await popup.textContent()).toContain("Свободный район");
    const before = await page.evaluate(() => (window as any).__hook.S().budget);
    await page.click("[data-district-claim]");
    const after = await page.evaluate(({ id }) => {
      const S = (window as any).__hook.S();
      return { owned: S.districtById.has(id), budget: S.budget };
    }, info!);
    expect(after.owned).toBe(true);
    expect(after.budget).toBeLessThan(before - 14);
    expect(await popup.textContent()).toContain("Выберите регион");
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
      "три латинских буквы",
    );
    expect(pageErrors).toEqual([]);
  });
});
