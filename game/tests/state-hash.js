// Выполняется в странице игры. Строит устойчивый хеш состояния симуляции,
// чтобы сравнивать исходную версию и переписанную байт в байт.
(function () {
  function fnv(h, str) {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function skip(v) {
    return (
      typeof v === "function" ||
      (typeof Node !== "undefined" && v instanceof Node) ||
      (typeof ImageData !== "undefined" && v instanceof ImageData) ||
      (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap)
    );
  }
  function walk(v, h, seen) {
    if (v === null) return fnv(h, "null");
    const t = typeof v;
    if (t === "number") return fnv(h, "n" + (Object.is(v, -0) ? "-0" : String(v)));
    if (t === "string") return fnv(h, "s" + v);
    if (t === "boolean") return fnv(h, v ? "T" : "F");
    if (t === "undefined") return fnv(h, "u");
    if (skip(v)) return fnv(h, "skip");
    if (ArrayBuffer.isView(v)) {
      h = fnv(h, "ta" + v.length);
      for (let i = 0; i < v.length; i++) h = fnv(h, String(v[i]) + ",");
      return h;
    }
    if (seen.has(v)) return fnv(h, "cycle");
    seen.add(v);
    if (Array.isArray(v)) {
      h = fnv(h, "[" + v.length);
      for (let i = 0; i < v.length; i++) h = walk(v[i], h, seen);
      return fnv(h, "]");
    }
    if (v instanceof Map) {
      h = fnv(h, "map" + v.size);
      for (const [k, x] of v) h = walk(x, walk(k, h, seen), seen);
      return h;
    }
    if (v instanceof Set) {
      h = fnv(h, "set" + v.size);
      for (const x of v) h = walk(x, h, seen);
      return h;
    }
    h = fnv(h, "{");
    for (const k of Object.keys(v).sort()) {
      if (skip(v[k])) continue;
      h = walk(v[k], fnv(h, k + ":"), seen);
    }
    return fnv(h, "}");
  }
  window.__digest = function (S) {
    const out = {};
    let all = 2166136261;
    for (const k of Object.keys(S).sort()) {
      const d = walk(S[k], 2166136261, new WeakSet());
      out[k] = d.toString(16);
      all = fnv(all, k + d);
    }
    out.__all = all.toString(16);
    return out;
  };
})();
