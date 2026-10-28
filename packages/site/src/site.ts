// The entry script of the family's pages (decision 0006): it puts the sea in motion on a page
// whose `<body>` declares a sea state. Everything the page says is in its HTML; this script only
// adds motion, and a page without it is complete.

import { createSea, type SeaState } from "@meltemi/ocean";

const state = document.body.dataset["sea"];
const canvas = document.querySelector<HTMLCanvasElement>(".sea-canvas");

if (canvas && state && state !== "still") {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sea = createSea(canvas, { state: state as SeaState, reducedMotion });
  sea.start();
  addEventListener("resize", () => sea.resize());
}
