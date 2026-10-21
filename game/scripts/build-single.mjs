// Собирает игру в один самодостаточный HTML-файл: dist-single/index.html.
// Его можно открыть двойным щелчком (file://) или выложить как есть на любой хостинг.
import { build } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "game-single-"));

await build({ root, logLevel: "error", build: { outDir: tmp, emptyOutDir: true, sourcemap: false } });

let html = fs.readFileSync(path.join(tmp, "index.html"), "utf8");
const read = (ref) => fs.readFileSync(path.join(tmp, ref.replace(/^\.?\//, "")), "utf8");

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+\.js)"[^>]*><\/script>/, (_, src) => {
  const js = read(src).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
  return `<script type="module">${js}</script>`;
});
// Манифест в одиночном файле не нужен, иконку кладём внутрь.
const icon = fs.readFileSync(path.join(root, "public/app-icon.svg"), "utf8");
html = html.replace(/<link rel="manifest"[^>]*>\s*/, "");
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" type="image/svg+xml">`);

const out = path.join(root, "dist-single");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`dist-single/index.html — ${(html.length / 1024).toFixed(0)} КБ`);
