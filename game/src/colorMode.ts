import { drawRegion } from "./draw";
import { C, cmode, setCmode } from "./state";

const SPECK = {
  промышленный: "s-ind",
  сырьевой: "s-mine",
  аграрный: "s-agro",
  лесопромышленный: "s-wood",
  научный: "s-it",
  туристический: "s-tour",
  административный: "s-gov",
  логистический: "s-log",
  "спальный пригород": "c-izhs",
  многофункциональный: "paper-2",
};
export function specColor(c) {
  return C[SPECK[c.spec] || "paper-2"];
}

export function setupColorMode() {
  document.querySelectorAll("[data-cm]").forEach((b) =>
    b.addEventListener("click", () => {
      setCmode(b.dataset.cm);
      document
        .querySelectorAll("[data-cm]")
        .forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      document.querySelectorAll(".lg-growth").forEach((x) => (x.hidden = cmode !== "growth"));
      document.querySelectorAll(".lg-spec").forEach((x) => (x.hidden = cmode !== "spec"));
      drawRegion();
    }),
  );
}
