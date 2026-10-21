// Выполняется в странице игры после появления window.__hook.
// Возвращает отпечатки состояния после детерминированных сценариев.
// which: "classic" — обычная партия и действия игрока (сверяются с исходной версией),
// "planet" — планета и территория (собственный эталон), без аргумента — всё.
window.__runScenarios = function (which) {
  const classic = which !== "planet",
    planet = which !== "classic";
  const h = window.__hook;
  const out = {};
  const steps = (m) => {
    for (let i = 0; i < m; i++) h.stepMonth();
  };

  if (classic) {
    // A. Стартовая «областная» карта, 30 лет без вмешательства.
    h.init(20261018);
    out.regionStart = window.__digest(h.S());
    steps(12 * 30);
    out.region30y = window.__digest(h.S());
  }
  if (planet) {
    // B. Планета, 10 лет без вмешательства.
    h.init(777, {
      planet: true,
      capName: "Столица",
      cultureId: "RU",
      continentCount: 5,
      continentNameStyle: "geographic",
      foreignCount: 3,
    });
    out.planetStart = window.__digest(h.S());
    steps(12 * 10);
    out.planet10y = window.__digest(h.S());
  }
  if (classic) {
    // C. Обычная партия с действиями игрока: город, дорога, строительство.
    h.init(4242, { capName: "Альфа", cultureId: "PL" });
    const S = h.S();
    S.budget = 500;
    const cap = S.cities[0];
    const log = [];
    for (const [dx, dy] of [
      [60, 20],
      [-70, 10],
      [30, -80],
      [-40, 70],
      [100, 90],
    ]) {
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
    for (let i = 0; i < 3; i++)
      if (!h.canAct(S.cities[0], "airUpgrade")) h.doAct(S.cities[0], "airUpgrade");
    if (S.cities.length > 1) h.buildLink(0, 1, "road", "national", "class");
    out.actionsFounded = log;
    out.actionsStart = window.__digest(h.S());
    steps(12 * 15);
    out.actions15y = window.__digest(h.S());
    out.actionsCities = h.S().cities.length;
    out.airport = { level: cap.airLevel, name: cap.airportName, code: cap.airportCode };
  }
  if (planet) {
    // D. Планета: присоединение регионов, затем 5 лет.
    h.init(9001, {
      planet: true,
      capName: "Дельта",
      cultureId: "RU",
      continentCount: 5,
      continentNameStyle: "geographic",
      foreignCount: 2,
    });
    const P = h.S();
    const c0 = P.cities[0];
    const claimed = [];
    for (const [dx, dy] of [
      [120, 0],
      [-120, 0],
      [0, 120],
      [0, -120],
      [130, 110],
      [-120, 110],
      [240, 0],
      [0, 240],
      [-240, 0],
      [0, -240],
    ]) {
      const id = h.districtAt(c0.x + dx, c0.y + dy);
      if (id >= 0 && !P.districtById.has(id) && claimed.length < 3) {
        h.claimDistrict(id, -1);
        claimed.push(id);
      }
    }
    h.makeRuralSites(P.seed, P.ruralPool);
    h.evaluate();
    out.districtsClaimed = claimed;
    if (h.regionClaimCost)
      out.claimCosts = claimed.map((id) => +h.regionClaimCost(id).cost.toFixed(3));
    out.districtsStart = window.__digest(h.S());
    steps(12 * 5);
    out.districts5y = window.__digest(h.S());
  }
  return out;
};
