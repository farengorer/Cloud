// Снимает эталон планетарных сценариев с ТЕКУЩЕЙ версии игры (не с исходника: планета и территория
// менялись намеренно). Запуск: node tests/capture-planet.mjs > tests/golden-planet.json
// Эталон нужно пересобирать только при намеренном изменении правил, с объяснением в коммите.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root: path.join(here, ".."), server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const f of ["seed-env.js", "state-hash.js", "scenarios.js"]) await page.addInitScript(fs.readFileSync(path.join(here, f), "utf8"));
await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__hook, null, { timeout: 60000 });
const out = await page.evaluate((which) => window.__runScenarios(which), "planet");
await browser.close();
await server.close();
if (errors.length) console.error("ОШИБКИ СТРАНИЦЫ:\n" + errors.join("\n"));
console.log(JSON.stringify(out, null, 2));
