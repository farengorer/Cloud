// Выполняется в странице игры после появления window.__hook.
// Возвращает отпечатки состояния после детерминированных сценариев.
window.__runScenarios = function () {
  const h = window.__hook;
  const out = {};
  const steps = (m) => { for (let i = 0; i < m; i++) h.stepMonth(); };

  // A. Стартовая «областная» карта, 30 лет без вмешательства.
  h.init(20261018);
  out.regionStart = window.__digest(h.S());
  steps(12 * 30);
  out.region30y = window.__digest(h.S());

  // B. Планета, 10 лет без вмешательства.
  h.init(777, { planet: true, capName: "Столица", cultureId: "RU", continentCount: 5, continentNameStyle: "geographic", foreignCount: 3 });
  out.planetStart = window.__digest(h.S());
  steps(12 * 10);
  out.planet10y = window.__digest(h.S());

  // C. Планета с действиями игрока: город, дорога, строительство.
  h.init(4242, { capName: "Альфа", cultureId: "PL" });
  const S = h.S();
  S.budget = 500;
  const cap = S.cities[0];
  const log = [];
  for (const [dx, dy] of [[60, 20], [-70, 10], [30, -80], [-40, 70], [100, 90]]) {
    const before = S.cities.length;
    h.found(cap.x + dx, cap.y + dy);
    log.push(S.cities.length - before);
  }
  for (let j = 1; j < S.cities.length; j++) h.buildLink(0, j, "road", "regional");
  if (S.cities.length > 2) h.buildLink(0, 2, "rail");
  for (const k of ["hosp", "uni", "mus", "air", "station"]) {
    if (!h.canAct(S.cities[0], k)) h.doAct(S.cities[0], k);
  }
  out.actionsFounded = log;
  out.actionsStart = window.__digest(h.S());
  steps(12 * 15);
  out.actions15y = window.__digest(h.S());
  out.actionsCities = h.S().cities.length;
  return out;
};
