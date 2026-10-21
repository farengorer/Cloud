import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { build, preview, type PreviewServer } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let outDir: string;
let server: PreviewServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-dist-"));
  await build({ root, logLevel: "error", build: { outDir, emptyOutDir: true } });
  server = await preview({ root, logLevel: "error", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
  url = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.httpServer.close(() => r()) : r()));
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("продакшен-сборка", () => {
  it("стартует без ошибок и без недостающих локальных файлов", async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    const missing: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().startsWith(url) && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#menuNew", { state: "visible" });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    expect(await page.locator("#region").isVisible()).toBe(true);
  });

  it("публикует манифест и иконку", () => {
    expect(fs.existsSync(path.join(outDir, "manifest.webmanifest"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "app-icon.svg"))).toBe(true);
  });
});
