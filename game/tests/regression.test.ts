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
  server = await createServer({ root: path.join(here, ".."), server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
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
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#play")!.disabled, null, { timeout: 60000 });
    await page.click("#step");
    expect(await page.locator("#play").textContent()).toBeTruthy();
    expect(pageErrors).toEqual([]);
  });
});
