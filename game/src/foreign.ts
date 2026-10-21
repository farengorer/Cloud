import { GOODS } from "./economy";
import { S } from "./state";
import { $, esc, fmtCargoTonnes, fmtM, fmtPop, fmtTonPrice, pricePerTonne } from "./util";

export function drawNb() {
  const box = $("#nbBody");
  if (!box) return;
  const html = S.ext.length
    ? S.ext
        .map((e) => {
          const g = e.tradeGood,
            volume = (e.tradeOut && e.tradeOut[g]) || 0,
            demand = (e.tradeUse && e.tradeUse[g]) || 0,
            mass = GOODS[g] ? GOODS[g].tonnes : 0,
            cities = (e.cities || []).map((c) => esc(c.name) + " · " + fmtPop(c.P)).join(", ");
          return (
            '<div class="nb"><h3>' +
            esc(e.name) +
            " · " +
            fmtPop(e.P) +
            '</h3><div class="nbgrid"><div><span class="label">Столица</span><b>' +
            esc((e.cities || []).find((c) => c.capital)?.name || "–") +
            '</b></div><div><span class="label">Культура</span><b>' +
            esc(e.culture || "–") +
            '</b></div><div><span class="label">Городов</span><b>' +
            (e.cities || []).length +
            '</b></div><div><span class="label">Специализация</span><b>' +
            (GOODS[g] ? GOODS[g].t : g) +
            " · " +
            fmtTonPrice(pricePerTonne(g)) +
            '</b></div><div><span class="label">Предложение</span><b>' +
            fmtCargoTonnes(volume * mass) +
            '/год</b></div><div><span class="label">Спрос</span><b>' +
            fmtCargoTonnes(demand * mass) +
            '/год</b></div></div><p class="note">Города: ' +
            cities +
            "</p></div>"
          );
        })
        .join("")
    : '<p class="note">В настройках выбрано 0 иностранных государств.</p>';
  const tr = S.trade || { imports: 0, exports: 0, balance: 0, volume: 0, capacity: 0, demand: 0 };
  const cargo = tr.capacity
    ? "порты пропустили " +
      fmtCargoTonnes(tr.volume || 0) +
      " из " +
      fmtCargoTonnes(tr.capacity) +
      " груза в год"
    : "морские и речные грузоперевозки не открыты";
  const summary =
    '<p class="note">Общий рынок планеты · экспорт ' +
    fmtM(tr.exports || 0) +
    " · импорт " +
    fmtM(tr.imports || 0) +
    " · сальдо " +
    ((tr.balance || 0) >= 0 ? "+" : "−") +
    fmtM(Math.abs(tr.balance || 0)) +
    ". " +
    cargo +
    ((tr.demand || 0) > (tr.capacity || 0)
      ? " · спрос на перевозку превышает пропускную способность"
      : "") +
    ".</p>";
  if (box.dataset.h !== summary + html) {
    box.innerHTML = summary + html;
    box.dataset.h = summary + html;
  }
}
