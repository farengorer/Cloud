import { refreshSaveStatus, setPlay } from "./controls";
import { render } from "./draw";
import { basePrices, drawMarket, priceTarget, smoothPrices, zeroGoods } from "./economy";
import { evaluate, init, logEv, stepYear } from "./model";
import { loadSave, lsKey, saveGame } from "./saveload";
import {
  CANWRITE,
  DB,
  GAMES,
  MP,
  NAMESC,
  S,
  UID,
  USERC,
  onMsg,
  setCANWRITE,
  setDB,
  setGAMES,
  setMP,
  setOnMsg,
  setUID,
  setUSERC,
  setWq,
  wq,
  yps,
} from "./state";
import { $, clamp, esc, fmtPop } from "./util";

export const CAPS = ["Верхнедонск", "Нижнереченск", "Белогорск", "Староозёрск"],
  REGN = ["Верхнедонская", "Нижнереченская", "Белогорская", "Староозёрская"];
export function regionName() {
  return S.regionName || REGN[S.slot || 0] + " область";
}
export async function mpInit() {
  const cl = window.claude;
  if (!cl || !cl.use) {
    try {
      const raw = localStorage.getItem(lsKey("solo"));
      if (raw) S_SOLO.save = { year: JSON.parse(raw).meta.year };
    } catch (e) {}
    onRender();
    return;
  }
  try {
    setDB(await cl.use("db"));
  } catch (e) {
    setDB(null);
  }
  try {
    setUSERC(await cl.use("user"));
  } catch (e) {
    setUSERC(null);
  }
  if (USERC) {
    try {
      setUID(await USERC.id());
    } catch (e) {}
    try {
      setCANWRITE(await USERC.can("data.write"));
    } catch (e) {}
  }
  if (!DB || !UID) {
    setDB(null);
    onRender();
    return;
  }
  DB.collection("games").onSnapshot(
    (snap) => {
      setGAMES(snap.docs.filter((d) => d.exists).map((d) => Object.assign({ id: d.id }, d.data())));
      resolveNames(GAMES.flatMap((g) => g.players || []));
      onRender();
    },
    () => {},
  );
  try {
    const s = await DB.doc("data/users/" + UID + "/profile").get();
    if (s.exists) S_SOLO.meta = s.data();
  } catch (e) {}
  try {
    const s = await DB.doc("data/users/" + UID + "/save-solo").get();
    if (s.exists) S_SOLO.save = s.data();
  } catch (e) {}
  onRender();
}
export const S_SOLO = { meta: null, save: null };
async function resolveNames(ids) {
  if (!USERC || !USERC.profiles) return;
  const need = [...new Set(ids)].filter((i) => i && NAMESC[i] == null);
  if (!need.length) return;
  try {
    const ps = await USERC.profiles(need);
    need.forEach((i) => {
      NAMESC[i] = (ps[i] && ps[i].name) || "";
    });
    onRender();
    if (MP) applyNeighbors();
  } catch (e) {}
}
function pname(uid, slot) {
  if (uid === UID) return "вы";
  return NAMESC[uid] || "игрок " + ((slot == null ? 0 : slot) + 1);
}
export function dbw(fn) {
  setWq(
    wq.then(fn).catch((e) => {
      if (e && e.code === "invalid_argument") {
        setCANWRITE(false);
        setOnMsg(
          "Похоже, у вас доступ только на просмотр. Попросите владельца выдать роль «Участник».",
        );
        onRender();
      }
    }),
  );
  return wq;
}
async function mpCreate() {
  if (!DB) return;
  const gid = "g" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const g = {
    seed: (Math.random() * 1e9) | 0,
    year: 2026,
    players: [UID],
    host: UID,
    prices: basePrices(),
    touched: Date.now(),
    created: Date.now(),
  };
  await dbw(() => DB.doc("games/" + gid).set(g));
  await mpJoin(gid);
}
async function mpJoin(gid) {
  if (!DB) return;
  $("#startPanel").hidden = true;
  const ref = DB.doc("games/" + gid);
  let snap = await ref.get();
  if (!snap.exists) return;
  let g = snap.data();
  if ((g.players || []).indexOf(UID) < 0) {
    if (g.players.length >= 4) {
      setOnMsg("В этой игре уже четыре игрока.");
      onRender();
      return;
    }
    const L = await ref.acquire({ holder: UID, ttlMs: 4000 });
    if (!L.acquired) {
      setOnMsg("Кто-то как раз заходит в эту игру, попробуйте через пару секунд.");
      onRender();
      return;
    }
    snap = await ref.get();
    g = snap.data();
    if (g.players.indexOf(UID) < 0) {
      if (g.players.length >= 4) return;
      g = Object.assign({}, g, { players: g.players.concat([UID]) });
      await dbw(() => ref.update({ players: g.players, touched: Date.now() }));
    }
  }
  const slot = g.players.indexOf(UID);
  setPlay(false);
  mpLeave(true);
  const ok = await loadSave(gid);
  if (!ok) {
    init(g.seed * 7 + slot * 1000003, { slot, year: g.year, prices: g.prices });
  }
  setMP({
    gid,
    game: g,
    slot,
    regions: {},
    auto: false,
    adv: -1,
    stepping: false,
    lastSave: S.year,
  });
  S.prices = Object.assign({}, g.prices);
  MP.unG = ref.onSnapshot(
    (sn) => {
      if (!sn.exists) {
        mpLeave();
        setOnMsg("Игра удалена.");
        render();
        return;
      }
      MP.game = sn.data();
      resolveNames(MP.game.players);
      catchUp();
      onRender();
    },
    () => {},
  );
  MP.unR = DB.collection("games/" + gid + "/regions").onSnapshot(
    (sn) => {
      const r = {};
      sn.docs.forEach((d) => {
        if (d.exists) r[d.id] = d.data();
      });
      MP.regions = r;
      applyNeighbors();
      maybeAdvance();
      onRender();
      drawMarket();
    },
    () => {},
  );
  dbw(() => DB.doc("data/users/" + UID + "/profile").set({ lastGid: gid, t: Date.now() }));
  logEv("Вы вошли в онлайн-игру, ваша область: " + regionName());
  mpPush(false);
  evaluate();
  render();
}
export function mpLeave(silent) {
  if (!MP) return;
  try {
    MP.unG && MP.unG();
    MP.unR && MP.unR();
  } catch (e) {}
  const gid = MP.gid;
  setMP(null);
  resetNeighbors();
  if (!silent) {
    saveGame(gid);
    setOnMsg("Вы вышли из онлайн-игры. Вернуться можно в любой момент, область сохранена.");
    render();
  }
}
export function mpPush(ready) {
  if (!MP || !DB) return;
  const cs = S.cities,
    P_ = cs.reduce((a, c) => a + c.P + c.R, 0);
  const rnd = (o) => {
    const r = {};
    for (const g in o) if (o[g] > 0.01) r[g] = +o[g].toFixed(2);
    return r;
  };
  const doc = {
    slot: MP.slot,
    year: S.year,
    ready: !!ready,
    P: Math.round(P_),
    Q: +(S.Q || 0).toFixed(4),
    out: rnd(S.out || {}),
    use: rnd(S.use || {}),
    cities: cs.length,
    capital: cs[0].name,
    region: regionName(),
    t: Date.now(),
  };
  MP.myReady = !!ready;
  const gid = MP.gid;
  dbw(() => DB.doc("games/" + gid + "/regions/" + UID).set(doc));
}
function catchUp() {
  if (!MP || MP.stepping) return;
  const g = MP.game;
  if (g.year <= S.year) return;
  MP.stepping = true;
  let k = 0;
  while (S.year < g.year && k < 200) {
    S.prevPrices = S.prices;
    S.prices = Object.assign({}, g.prices);
    stepYear();
    k++;
  }
  MP.stepping = false;
  mpPush(false);
  if (MP.auto) {
    const g0 = MP.game.year;
    setTimeout(
      () => {
        if (MP && MP.auto && MP.game.year === g0) mpPush(true);
      },
      Math.round(1000 / yps),
    );
  }
  if (S.year - MP.lastSave >= 100) {
    MP.lastSave = S.year;
    saveGame(MP.gid);
  }
  render();
}
function maybeAdvance() {
  if (!MP) return;
  const g = MP.game,
    pl = g.players || [];
  if (MP.adv === g.year) return;
  const regs = pl.map((u) => MP.regions[u]);
  if (!regs.length || regs.some((r) => !r || r.year !== g.year || !r.ready)) return;
  const out = zeroGoods(),
    use = zeroGoods();
  regs.forEach((r) => {
    for (const k in r.out || {}) out[k] = (out[k] || 0) + r.out[k];
    for (const k in r.use || {}) use[k] = (use[k] || 0) + r.use[k];
  });
  MP.adv = g.year;
  const np = smoothPrices(g.prices, priceTarget(out, use));
  const gid = MP.gid,
    ny = g.year + 1;
  dbw(() => DB.doc("games/" + gid).update({ year: ny, prices: np, touched: Date.now() }));
}
export function mpReady() {
  if (!MP) return;
  mpPush(true);
  onRender();
}
function mpKick(uid) {
  if (!MP || MP.game.host !== UID) return;
  const pl = MP.game.players.filter((u) => u !== uid);
  const gid = MP.gid;
  dbw(() => DB.doc("games/" + gid).update({ players: pl }));
}
/* neighbours: players sit in a ring; your east and west neighbours (and, with four players, the one to the south) replace the AI regions */
function resetNeighbors() {
  S.ext.forEach((e) => {
    e.player = null;
    e.name = e.countryName || e.name;
    e.base = e.countryBase || e.base;
    if (e.aiP) e.P = e.aiP;
  });
}
function applyNeighbors() {
  if (!MP || !S.ext || S.planet) return;
  resetNeighbors();
  const pl = MP.game.players || [],
    n = pl.length,
    i = pl.indexOf(UID);
  if (i < 0) return;
  const map = {};
  if (n >= 2) map[0] = pl[(i + 1) % n];
  if (n >= 3) map[1] = pl[(i - 1 + n) % n];
  if (n === 4) map[2] = pl[(i + 2) % n];
  for (const k in map) {
    const uid = map[k],
      r = MP.regions[uid],
      e = S.ext[k];
    if (!e || !uid || uid === UID) continue;
    if (!e.aiP) e.aiP = e.P;
    e.player = uid;
    e.name =
      (r && r.region ? r.region : "Область игрока") + " (" + pname(uid, pl.indexOf(uid)) + ")";
    if (r) {
      e.P = Math.max(r.P, 1000);
      e.base = Math.exp(clamp((r.Q || 0) - (S.Q || 0), -1.5, 1.5));
    }
  }
  evaluate();
}
export function onRender() {
  const box = $("#onBody"),
    st = $("#onStatus");
  if (!box) return;
  let html = "";
  if (!DB) {
    st.textContent = "одиночная игра";
    html =
      '<div class="found"><button type="button" id="soloSave">Сохранить партию</button>' +
      (S_SOLO.save
        ? '<button type="button" id="soloLoad">Продолжить сохранённую (год ' +
          S_SOLO.save.year +
          ")</button>"
        : "") +
      '</div><p class="note">Партия сохраняется в этом браузере на этом устройстве, автоматически каждые 100 лет и по кнопке. Онлайн-игра с другими доступна в версии внутри Claude.</p>';
  } else if (!MP) {
    st.textContent = "одиночная игра";
    const mine = GAMES.filter((g) => (g.players || []).indexOf(UID) >= 0),
      open = GAMES.filter(
        (g) =>
          (g.players || []).indexOf(UID) < 0 &&
          (g.players || []).length < 4 &&
          Date.now() - (g.touched || 0) < 3 * 864e5,
      );
    const row = (g, joined) =>
      '<tr><td class="l">Игра ' +
      esc(pname(g.host, 0) === "вы" ? "ваша" : "от " + pname(g.host, 0)) +
      "</td><td>" +
      (g.players || []).length +
      "/4</td><td>" +
      g.year +
      '</td><td><button type="button" data-join="' +
      g.id +
      '">' +
      (joined ? "Вернуться" : "Войти") +
      "</button></td></tr>";
    html =
      '<div class="found"><button type="button" id="mpCreate"' +
      (CANWRITE === false ? " disabled" : "") +
      ">Создать онлайн-игру</button>" +
      (S_SOLO.save
        ? '<button type="button" id="soloLoad">Продолжить сохранённую одиночную (год ' +
          S_SOLO.save.year +
          ")</button>"
        : "") +
      '<button type="button" id="soloSave">Сохранить одиночную</button></div>' +
      '<p class="note">У каждого игрока своя область, соседи по кольцу становятся живыми соседями за границей, рынок общий. Год наступает, когда все нажали «Готов». Друзья открывают эту же страницу и входят в вашу игру из списка.</p>' +
      (mine.length || open.length
        ? '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Игра</th><th>Игроков</th><th>Год</th><th></th></tr></thead><tbody>' +
          mine.map((g) => row(g, true)).join("") +
          open.map((g) => row(g, false)).join("") +
          "</tbody></table></div>"
        : '<p class="note">Открытых игр пока нет.</p>');
  } else {
    const g = MP.game,
      pl = g.players || [];
    const waiting = pl.filter((u) => {
      const r = MP.regions[u];
      return !r || r.year !== g.year || !r.ready;
    });
    st.textContent =
      "онлайн, год " +
      g.year +
      (waiting.length
        ? ", ждём " + waiting.map((u) => (u === UID ? "вас" : pname(u, pl.indexOf(u)))).join(", ")
        : ", все готовы");
    const rows = pl
      .map((u, k) => {
        const r = MP.regions[u];
        const ok = r && r.year === g.year && r.ready;
        return (
          '<tr><td class="l">' +
          esc(pname(u, k)) +
          (u === g.host ? " · создатель" : "") +
          '</td><td class="l s">' +
          (r ? esc(r.region) : "входит…") +
          "</td><td>" +
          (r ? fmtPop(r.P) : "–") +
          "</td><td>" +
          (r ? r.cities : "–") +
          '</td><td class="' +
          (ok ? "up" : "") +
          '">' +
          (ok ? "готов" : "думает") +
          "</td><td>" +
          (g.host === UID && u !== UID
            ? '<button class="link" type="button" data-kick="' + u + '">убрать</button>'
            : "") +
          "</td></tr>"
        );
      })
      .join("");
    html =
      '<div class="tablewrap"><table class="dt"><thead><tr><th class="l">Игрок</th><th class="l">Область</th><th>Жители</th><th>Городов</th><th>Ход</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<div class="found"><button type="button" id="mpReady"' +
      (MP.myReady && S.year === g.year ? " disabled" : "") +
      ">" +
      (MP.myReady && S.year === g.year
        ? "Вы готовы, ждём остальных"
        : "Готов к " + (g.year + 1) + " году") +
      '</button><button type="button" id="mpLeave">Выйти в одиночную игру</button></div>' +
      '<p class="note">«Запустить» в верхней панели ставит «Готов» автоматически каждый год с выбранной скоростью, и игра идёт в темпе самого медленного игрока. Область сохраняется каждые 100 лет.</p>';
  }
  if (onMsg) html += '<p class="note" style="color:var(--bad)">' + esc(onMsg) + "</p>";
  if (box.dataset.h !== html) {
    box.innerHTML = html;
    box.dataset.h = html;
  }
  refreshSaveStatus();
}

export function setupMultiplayer() {
  $("#onBody").addEventListener("click", (e) => {
    const t = e.target;
    setOnMsg("");
    if (t.id === "mpCreate") mpCreate();
    else if (t.id === "mpReady") mpReady();
    else if (t.id === "mpLeave") mpLeave();
    else if (t.id === "soloSave") {
      saveGame("solo").then(() => {
        if (DB) setOnMsg("");
        S_SOLO.save = { year: S.year };
        onRender();
      });
    } else if (t.id === "soloLoad") {
      setPlay(false);
      loadSave("solo").then((ok) => {
        if (ok) {
          render();
        }
      });
    }
    const j = t.closest("[data-join]");
    if (j) mpJoin(j.dataset.join);
    const k = t.closest("[data-kick]");
    if (k) mpKick(k.dataset.kick);
  });
}
