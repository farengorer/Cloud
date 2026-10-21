// Снимает эталонные отпечатки с исходной версии (legacy/index.html).
// Запуск: node tests/capture-legacy.mjs > tests/golden.json
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const legacy = fs.readFileSync(path.join(here, "../legacy/index.html"), "utf8");
const HOOK =
  "window.__hook={init,stepMonth,found,canFound,foundCost,buildLink,doAct,canAct,S:()=>S};";
const marker = "\n})();\n</script>";
if (!legacy.includes(marker)) throw new Error("не найден конец скрипта");
const patched = legacy.replace(marker, "\n" + HOOK + "\n})();\n</script>");
const tmp = path.join(here, "../legacy/.patched.html");
fs.writeFileSync(tmp, patched);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(fs.readFileSync(path.join(here, "seed-env.js"), "utf8"));
await page.addInitScript(fs.readFileSync(path.join(here, "state-hash.js"), "utf8"));
await page.addInitScript(fs.readFileSync(path.join(here, "scenarios.js"), "utf8"));
await page.goto("file://" + tmp);
await page.waitForFunction(() => window.__hook, null, { timeout: 30000 });
const out = await page.evaluate(() => window.__runScenarios());
await browser.close();
fs.unlinkSync(tmp);
if (errors.length) console.error("ОШИБКИ СТРАНИЦЫ:\n" + errors.join("\n"));
console.log(JSON.stringify(out, null, 2));
