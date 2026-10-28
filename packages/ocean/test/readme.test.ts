// The README is the contract products consume (design D13): every API it names is exported, and
// every member of the handle it lists exists.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ocean from "../src/index.js";
import { fakeCanvas, harness, recordingContext } from "./fakes.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("the README, as the contract", () => {
  it("names only what the package exports", () => {
    const named = [
      "createSea",
      "heightAt",
      "slopeAt",
      "declaredAmplitude",
      "stillPicture",
      "placeMark",
      "STATES",
      "restProgress",
      "fleetSize",
      "createWind",
      "MARK_M",
      "MARK_HULL",
      "MARK_GRADIENT",
      "MAX_TILT",
      "BRAND_STILL",
    ];
    for (const name of named) {
      expect(readme, `the README names ${name}`).toContain(`\`${name}`);
      expect(ocean, `the package exports ${name}`).toHaveProperty(name);
    }
  });

  it("lists every member the handle has", () => {
    const sea = ocean.createSea(
      fakeCanvas({ "2d": recordingContext() }) as unknown as HTMLCanvasElement,
      { state: "home" },
      harness().env,
    );
    for (const member of [
      "renderer",
      "state",
      "frames",
      "figures",
      "progress",
      "wind",
      "quality",
      "start",
      "stop",
      "setProgress",
      "setWind",
      "restyle",
      "resize",
      "destroy",
    ]) {
      expect(readme, `the README lists ${member}`).toContain(`\`${member}`);
      expect(member in sea, `the handle has ${member}`).toBe(true);
    }
  });

  it("lists every member the wind's handle has", () => {
    const wind = ocean.createWind(
      fakeCanvas({ "2d": recordingContext() }) as unknown as HTMLCanvasElement,
      {},
      harness().env,
    );
    for (const member of [
      "renderer",
      "frames",
      "strength",
      "particles",
      "start",
      "stop",
      "setStrength",
      "restyle",
      "resize",
      "destroy",
    ]) {
      expect(readme, `the README lists ${member}`).toContain(`\`${member}`);
      expect(member in wind, `the wind's handle has ${member}`).toBe(true);
    }
  });

  it("names the four colour properties", () => {
    for (const name of ["--sea-point", "--sea-crest", "--sea-wind", "--sea-bg"]) {
      expect(readme).toContain(name);
    }
  });
});
