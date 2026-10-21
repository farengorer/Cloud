// Фиксирует источники случайности и времени, чтобы запуски были повторяемы.
(function () {
  let a = 0x1234abcd;
  Math.random = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fixed = 1760000000000;
  Date.now = () => fixed;
})();
