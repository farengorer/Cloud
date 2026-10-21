import { hex, mix } from "./colors";
import { P, RH, RW } from "./config";
import { HEAT, ramp } from "./layers";
import { airRouteStats, byKey, flightsPerMonth, linkSpeed } from "./model";
import { S, TT } from "./state";
import { clamp } from "./util";
import { seaD } from "./worldgen";

export const ARAMP = ["#1A9850", "#91CF60", "#E6E27A", "#FDAE61", "#E8553A", "#8E1B3A"].map(hex);
export function accRegion() {
  const o = S.cities[S.sel],
    key =
      S.sel +
      "|" +
      S.year +
      "|" +
      S.roads.length +
      "|" +
      S.roads.filter((r) => r.fast).length +
      "|" +
      S.cities.length +
      "|" +
      P.speed +
      "|" +
      (S.airRoutes || [])
        .map(
          (r) =>
            r.a +
            "-" +
            r.b +
            ":" +
            flightsPerMonth(r) +
            ":" +
            Math.round(airRouteStats(r)?.pax || 0),
        )
        .join(",");
  if (HEAT.ak === key && HEAT.aimg) return HEAT.aimg;
  HEAT.ak = key;
  const W = 240,
    H = 180,
    a = new Float32Array(W * H),
    cs = S.cities,
    n = cs.length,
    base = cs.map((c, k) => (k === o.i ? 0 : Math.max(0, TT[o.i][k] - 10))),
    segs = S.roads
      .filter((r) => r.mode === "road")
      .map((r) => {
        const A = byKey(r.a),
          B = byKey(r.b),
          v = linkSpeed(r);
        return {
          ax: A.ext ? A.gx : A.x,
          ay: A.ext ? A.gy : A.y,
          bx: B.ext ? B.gx : B.x,
          by: B.ext ? B.gy : B.y,
          ta: A.ext ? 1e9 : base[A.i],
          tb: B.ext ? 1e9 : base[B.i],
          v,
        };
      });
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const x = ((gx + 0.5) * RW) / W,
        y = ((gy + 0.5) * RH) / H;
      let t = 1e9;
      for (let k = 0; k < n; k++) {
        const v = base[k] + (75 * Math.hypot(cs[k].x - x, cs[k].y - y)) / 30;
        if (v < t) t = v;
      }
      for (const sg of segs) {
        const dx = sg.bx - sg.ax,
          dy = sg.by - sg.ay,
          L2 = dx * dx + dy * dy;
        if (!L2) continue;
        const u = clamp(((x - sg.ax) * dx + (y - sg.ay) * dy) / L2, 0, 1),
          px = sg.ax + u * dx,
          py = sg.ay + u * dy,
          L = Math.sqrt(L2),
          off = (75 * Math.hypot(x - px, y - py)) / 30;
        const v = Math.min(sg.ta + (75 * u * L) / sg.v, sg.tb + (75 * (1 - u) * L) / sg.v) + off;
        if (v < t) t = v;
      }
      a[gy * W + gx] = seaD(x, y) < 0 ? NaN : t + 5;
    }
  HEAT.acc = a;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d"),
    im = x.createImageData(W, H);
  for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const k = gy * W + gx,
        t = a[k];
      if (!(t >= 0)) continue;
      const r = ramp(ARAMP, t / 240),
        p = k * 4;
      const band = Math.floor(t / 30),
        edge =
          t <= 240 &&
          ((gx < W - 1 && Math.floor(a[k + 1] / 30) !== band) ||
            (gy < H - 1 && Math.floor(a[k + W] / 30) !== band));
      const col = edge ? mix(r, [20, 20, 20], 0.3) : r;
      im.data[p] = col[0];
      im.data[p + 1] = col[1];
      im.data[p + 2] = col[2];
      im.data[p + 3] = edge ? 210 : Math.round(255 * 0.6);
    }
  x.putImageData(im, 0, 0);
  HEAT.aimg = cv;
  return cv;
}
