import { bfs, stations } from "./city";
import { CAP, CELLKM, G } from "./config";
import { dist, logEv } from "./model";
import { S } from "./state";

export function aggCompute() {
  const cs = S.cities;
  cs.forEach((c) => {
    c.core = -1;
    c.sats = [];
  });
  cs.forEach((c) => {
    let best = -1;
    cs.forEach((o) => {
      if (o === c || o.P < 200000 || dist(o, c) > 13) return;
      if (o.P <= (c.flags.agg === o.i ? 0.8 : 1.15) * c.P) return;
      if (best < 0 || o.P > cs[best].P) best = o.i;
    });
    c.core = best;
  });
  cs.forEach((c) => {
    let g = 0;
    while (c.core >= 0 && cs[c.core].core >= 0 && g++ < 5) c.core = cs[c.core].core;
  });
  cs.forEach((c) => {
    if (c.core >= 0) cs[c.core].sats.push(c.i);
  });
  cs.forEach((c) => {
    c.PA = c.P + c.sats.reduce((a, i) => a + cs[i].P, 0);
  });
  cs.forEach((c) => {
    const was = c.flags.agg == null ? -1 : c.flags.agg;
    if (c.core !== was) {
      if (c.core >= 0) logEv("Город " + c.name + " вошёл в агломерацию «" + cs[c.core].name + "»");
      c.flags.agg = c.core;
    }
  });
  cs.forEach((c) => {
    if (c.core < 0) {
      if (c.extSt) {
        c.extSt = 0;
        if (!stations(c)) {
          c.stD.fill(255);
          c.metroCov = 0;
        }
      }
      return;
    }
    satMetro(c, cs[c.core]);
  });
}
function satMetro(s, c) {
  const key = c.i + "|" + stations(c) + "|" + c.metro.map((l) => l.st.length).join(",");
  if (s.smKey === key) return;
  s.smKey = key;
  const m = new Uint8Array(G * G);
  let n = 0;
  c.metro.forEach((l) =>
    l.st.forEach((p) => {
      const wx = c.x + (p[0] - c.cx) * CELLKM,
        wy = c.y + (p[1] - c.cy) * CELLKM,
        gx = Math.floor(s.cx + (wx - s.x) / CELLKM),
        gy = Math.floor(s.cy + (wy - s.y) / CELLKM);
      if (gx >= 0 && gy >= 0 && gx < G && gy < G) {
        m[gy * G + gx] = 1;
        n++;
      }
    }),
  );
  s.extSt = n;
  if (!n) {
    if (!stations(s)) {
      s.stD.fill(255);
      s.metroCov = 0;
    }
    return;
  }
  bfs(m, s.stD, 30);
  let a = 0,
    b = 0;
  for (let k = 0; k < G * G; k++) {
    if (s.foreign && s.foreign[k]) continue;
    const h = CAP[s.grid[k]];
    if (!h) continue;
    a += h;
    if (s.stD[k] <= 6) b += h;
  }
  s.metroCov = a ? b / a : 0;
}
export function planCity() {
  const c = S.cities[S.sel];
  return c && c.core >= 0 && S.cities[c.core] ? S.cities[c.core] : c;
}
export function isSat(c) {
  return c.core >= 0;
}
