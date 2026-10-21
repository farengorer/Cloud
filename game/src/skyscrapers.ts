import { stations } from "./city";
import { CAP, G, HIGH, SKY } from "./config";
import { logEv } from "./model";
import { rng } from "./state";
import { weightedOrder } from "./util";

export function skyUp(c, amount) {
  if (c.P < 450000 || amount <= 0) return 0;
  const gain = CAP[SKY] - CAP[HIGH];
  let n = Math.floor((amount + (c.carryS || 0)) / gain);
  c.carryS = amount + (c.carryS || 0) - n * gain;
  if (n < 1) return 0;
  const cand = [],
    w = [];
  const hasM = stations(c) > 0;
  for (let k = 0; k < G * G; k++) {
    if (c.grid[k] !== HIGH) continue;
    const d = Math.hypot((k % G) - c.cx, ((k / G) | 0) - c.cy);
    cand.push(k);
    w.push(
      Math.exp(-d / 9) *
        (hasM ? 1 + 4 * Math.exp(-c.stD[k] / 3) : 1) *
        (c.biz && c.bizD ? 1 + 5 * Math.exp(-c.bizD[k] / 3) : 1),
    );
  }
  if (!cand.length) return 0;
  let got = 0;
  for (const pos of weightedOrder(w, rng, n)) {
    c.grid[cand[pos]] = SKY;
    got += gain;
  }
  if (got && !c.flags.sky) {
    c.flags.sky = 1;
    logEv("Город " + c.name + ": построен первый небоскрёб");
  }
  return got;
}
