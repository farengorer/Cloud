/// <reference lib="webworker" />
import { prepareBase, renderTile, type PreparedBase, type ReliefBase } from "./render";

let base: PreparedBase | null = null;

type Message =
  | { type: "init"; base: ReliefBase }
  | { type: "anchors"; anchors: number[] }
  | { type: "tile"; id: number; L: number; tx: number; ty: number };

self.onmessage = (e: MessageEvent<Message>) => {
  const m = e.data;
  if (m.type === "init") base = prepareBase(m.base);
  else if (m.type === "anchors" && base) base.anchors = m.anchors;
  else if (m.type === "tile" && base) {
    const pixels = renderTile(base, m.L, m.tx, m.ty);
    (self as unknown as Worker).postMessage({ type: "tile", id: m.id, pixels }, [pixels.buffer]);
  }
};
