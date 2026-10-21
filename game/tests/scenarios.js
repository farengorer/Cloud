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
  // Рост пропускной способности аэропорта и повышение класса дороги.
  for (let i = 0; i < 3; i++) if (!h.canAct(S.cities[0], "airUpgrade")) h.doAct(S.cities[0], "airUpgrade");
  if (S.cities.length > 1) h.buildLink(0, 1, "road", "national", "class");
  out.actionsFounded = log;
  out.actionsStart = window.__digest(h.S());
  steps(12 * 15);
  out.actions15y = window.__digest(h.S());
  out.actionsCities = h.S().cities.length;
  out.airport = { level: cap.airLevel, name: cap.airportName, code: cap.airportCode };

  // D. Планета: присоединение районов, затем 5 лет.
  h.init(9001, { planet: true, capName: "Дельта", cultureId: "RU", continentCount: 5, continentNameStyle: "geographic", foreignCount: 2 });
  const P = h.S();
  const c0 = P.cities[0];
  const claimed = [];
  for (const [dx, dy] of [[30, 0], [-30, 0], [0, 30], [0, -30], [60, 60], [-60, 60], [90, 0], [0, 90], [-90, -90], [150, 0], [0, 150]]) {
    const id = h.districtAt(c0.x + dx, c0.y + dy);
    if (id >= 0 && !P.districtById.has(id) && claimed.length < 3) {
      h.claimDistrict(id, 0);
      claimed.push(id);
    }
  }
  h.makeRuralSites(P.seed, P.ruralPool);
  h.evaluate();
  out.districtsClaimed = claimed;
  out.districtsStart = window.__digest(h.S());
  steps(12 * 5);
  out.districts5y = window.__digest(h.S());
  return out;
};
