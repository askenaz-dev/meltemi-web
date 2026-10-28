// The specification `ocean-package`, "Still pictures from the same sea": every state at rest, in
// both schemes, is a well-formed SVG of at most 30 KB that carries its colours as attributes and
// nothing a page's policy would block.

import { describe, expect, it } from "vitest";
import { STATES } from "../src/states.js";
import { stillPicture } from "../src/still.js";

/** A small well-formedness check: one root, balanced elements, quoted attributes, no entities. */
function wellFormed(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) stack.push(name!);
  }
  const stripped = svg.replace(/<[^>]*>/g, "").trim();
  return stack.length === 0 && stripped === "" && svg.trimStart().startsWith("<svg");
}

describe("still pictures from the same sea", () => {
  for (const state of STATES) {
    for (const scheme of ["light", "dark"] as const) {
      it(`draws ${state} at rest in the ${scheme} scheme, within 30 KB and with nothing to block`, () => {
        const svg = stillPicture(state, { scheme });
        expect(wellFormed(svg), "well-formed SVG").toBe(true);
        const bytes = Buffer.byteLength(svg);
        expect(bytes, `${state} (${scheme}) weighs ${bytes} bytes`).toBeLessThanOrEqual(30 * 1024);
        expect(svg).not.toMatch(/<script|<style|href=|url\(|<image|<foreignObject/i);
        expect(svg).toMatch(/fill="#[0-9a-f]+"/i);
      });
    }
  }

  it("carries the colours it is given", () => {
    const svg = stillPicture("ide", {
      scheme: "dark",
      colours: { point: "#123456", crest: "#abcdef", wind: "#fedcba" },
    });
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).not.toContain("#2563eb");
  });

  it("draws the IDE's sails and the Diagrams flow, and the same picture every time", () => {
    expect(stillPicture("ide")).toMatch(/Z" fill=/);
    expect(stillPicture("diagrams")).toEqual(stillPicture("diagrams"));
  });

  it("refuses a colour that is not #hex or rgb()", () => {
    expect(() => stillPicture("home", { colours: { point: 'red" onload="x' } })).toThrow(
      /^a still picture's colour must be #hex or rgb\(\)/,
    );
  });

  it("refuses an unknown state, naming it", () => {
    expect(() => stillPicture("storm" as never)).toThrow(/received "storm"/);
  });
});
