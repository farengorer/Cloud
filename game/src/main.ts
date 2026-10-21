import "./style.css";
// Порядок импорта повторяет порядок секций исходного файла:
// config и state не зависят от остальных модулей и вычисляются первыми.
import "./config";
import "./state";
import "./util";
import "./terrain";
import "./city";
import "./model";
import "./actions";
import "./colors";
import "./draw";
import "./controls";
import "./colorMode";
import "./zones";
import "./villages";
import "./districts";
import "./metro";
import "./economy";
import "./multiplayer";
import "./saveload";
import "./worldgen";
import "./skyscrapers";
import "./agglomerations";
import "./energy";
import "./accessibility";
import "./resources";
import "./views";
import "./layers";
import "./foreign";
import "./app";
import { setupControls } from "./controls";
import { setupColorMode } from "./colorMode";
import { setupVillages } from "./villages";
import { setupDistricts } from "./districts";
import { setupMetro } from "./metro";
import { setupEconomy } from "./economy";
import { setupMultiplayer } from "./multiplayer";
import { setupViews } from "./views";
import { setupLayers } from "./layers";
import { setupApp } from "./app";
import { init, stepMonth } from "./model";
import { found, canFound, foundCost } from "./actions";
import { buildLink, doAct, canAct } from "./actions";
import { S } from "./state";

// Подписка на события и первый запуск — в том же порядке, что в исходнике.
setupControls();
setupColorMode();
setupVillages();
setupDistricts();
setupMetro();
setupEconomy();
setupMultiplayer();
setupViews();
setupLayers();
setupApp();

if (import.meta.env.DEV) {
  // Доступ для регрессионных тестов (tests/).
  (window as any).__hook = {
    init,
    stepMonth,
    found,
    canFound,
    foundCost,
    buildLink,
    doAct,
    canAct,
    S: () => S,
  };
}
