// The WebGL2 renderer (design D1). The sea is one draw of points: the vertex shader lifts each
// point of the lattice by the same sum of waves `heightAt` computes, from the same table, and
// projects it as `project` does; the fragment shader draws a round dot coloured from trough to
// crest and faded with depth. The shapes above the sea are one draw of triangles with a colour per
// vertex. Colours are premultiplied, and the canvas stays transparent where nothing is drawn, so
// the page's background and the still picture beneath show through.

import type { Colour, Palette } from "./colors.js";
import {
  lattice,
  latticeSize,
  type Frame,
  type Ink,
  type Quality,
  type Renderer,
} from "./frame.js";
import { CAMERA_HEIGHT, FAR, NEAR, type View } from "./scene.js";
import { definitionOf, type SeaState } from "./states.js";
import { declaredAmplitude, waveTable } from "./waves.js";

const SEA_VERTEX = `#version 300 es
precision highp float;
in vec2 a_grid;
uniform float u_time;
uniform float u_amp;
uniform vec4 u_wave[4];
uniform vec2 u_wave2[4];
uniform vec2 u_res;
uniform float u_horizon;
uniform float u_focal;
uniform float u_point;
uniform float u_maxAmp;
out float v_crest;
out float v_alpha;
void main() {
  float x = a_grid.x;
  float z = a_grid.y;
  float y = 0.0;
  for (int i = 0; i < 4; i++) {
    y += u_wave2[i].x * sin(u_wave[i].z * (u_wave[i].x * x + u_wave[i].y * z) - u_wave[i].w * u_time + u_wave2[i].y);
  }
  y *= u_amp;
  float scale = u_focal / z;
  float sx = u_res.x * 0.5 + x * scale;
  float sy = u_horizon + (${CAMERA_HEIGHT.toFixed(1)} - y) * scale;
  gl_Position = vec4(sx / u_res.x * 2.0 - 1.0, 1.0 - sy / u_res.y * 2.0, 0.0, 1.0);
  float depth = (z - ${NEAR.toFixed(1)}) / (${FAR.toFixed(1)} - ${NEAR.toFixed(1)});
  gl_PointSize = max(1.0, u_point * ${NEAR.toFixed(1)} / z);
  v_crest = smoothstep(-0.15 * u_maxAmp, 0.8 * u_maxAmp, y);
  v_alpha = (1.0 - depth) * (1.0 - 0.35 * depth);
}`;

const SEA_FRAGMENT = `#version 300 es
precision mediump float;
in float v_crest;
in float v_alpha;
uniform vec4 u_pointColor;
uniform vec4 u_crestColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float edge = 1.0 - smoothstep(0.16, 0.25, d);
  vec4 colour = mix(u_pointColor, u_crestColor, v_crest);
  float a = colour.a * v_alpha * edge;
  outColor = vec4(colour.rgb * a, a);
}`;

const SHAPE_VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_colour;
uniform vec2 u_res;
out vec4 v_colour;
void main() {
  gl_Position = vec4(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0, 0.0, 1.0);
  v_colour = a_colour;
}`;

const SHAPE_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_colour;
out vec4 outColor;
void main() {
  outColor = v_colour;
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2 could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL2 refused a shader: ${log ?? "no log"}`);
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("WebGL2 could not create a program");
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`WebGL2 could not link a program: ${log ?? "no log"}`);
  }
  return p;
}

const rgba = (c: Colour): [number, number, number, number] => [c.r, c.g, c.b, c.a];

/** Creates the WebGL2 renderer, or throws when the context cannot build its programs. */
export function webglRenderer(gl: WebGL2RenderingContext, palette: Palette): Renderer {
  const seaProgram = program(gl, SEA_VERTEX, SEA_FRAGMENT);
  const shapeProgram = program(gl, SHAPE_VERTEX, SHAPE_FRAGMENT);
  const seaVao = gl.createVertexArray();
  const seaBuffer = gl.createBuffer();
  const shapeVao = gl.createVertexArray();
  const shapeBuffer = gl.createBuffer();
  if (!seaVao || !seaBuffer || !shapeVao || !shapeBuffer) {
    throw new Error("WebGL2 could not create its buffers");
  }

  const seaU = (name: string) => gl.getUniformLocation(seaProgram, name);
  const u = {
    time: seaU("u_time"),
    amp: seaU("u_amp"),
    wave: seaU("u_wave"),
    wave2: seaU("u_wave2"),
    res: seaU("u_res"),
    horizon: seaU("u_horizon"),
    focal: seaU("u_focal"),
    point: seaU("u_point"),
    maxAmp: seaU("u_maxAmp"),
    pointColour: seaU("u_pointColor"),
    crestColour: seaU("u_crestColor"),
    shapeRes: gl.getUniformLocation(shapeProgram, "u_res"),
  };

  // The wave table never changes: it is the same constants `heightAt` reads.
  const table = waveTable();
  const waves = new Float32Array(16);
  const waves2 = new Float32Array(8);
  table.forEach((w, i) => {
    waves.set([w.dx, w.dz, w.k, w.omega], i * 4);
    waves2.set([w.amplitude, w.phase], i * 2);
  });
  gl.useProgram(seaProgram);
  gl.uniform4fv(u.wave, waves);
  gl.uniform2fv(u.wave2, waves2);

  gl.bindVertexArray(seaVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, seaBuffer);
  const gridAt = gl.getAttribLocation(seaProgram, "a_grid");
  gl.enableVertexAttribArray(gridAt);
  gl.vertexAttribPointer(gridAt, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(shapeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
  const posAt = gl.getAttribLocation(shapeProgram, "a_pos");
  const colourAt = gl.getAttribLocation(shapeProgram, "a_colour");
  gl.enableVertexAttribArray(posAt);
  gl.vertexAttribPointer(posAt, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(colourAt);
  gl.vertexAttribPointer(colourAt, 4, gl.FLOAT, false, 24, 8);
  gl.bindVertexArray(null);

  let colours = palette;
  let lost = false;
  let gridKey = "";
  let gridCount = 0;
  let shapeData = new Float32Array(6 * 1024);
  const canvas = gl.canvas as HTMLCanvasElement;
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
  };
  canvas.addEventListener?.("webglcontextlost", onLost);

  const ensureGrid = (view: View, quality: Quality) => {
    const key = `${view.width}x${view.height}:${quality}`;
    if (key === gridKey) return;
    const { columns, rows } = latticeSize("webgl2", quality);
    const points = lattice(view, columns, rows);
    gl.bindBuffer(gl.ARRAY_BUFFER, seaBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
    gridCount = points.length / 2;
    gridKey = key;
  };

  const inkOf = (ink: Ink): Colour => colours[ink];

  const drawShapes = (frame: Frame) => {
    const { dpr } = frame;
    let n = 0;
    const need = frame.shapes.length * 6 * 6;
    if (shapeData.length < need) shapeData = new Float32Array(need * 2);
    const push = (x: number, y: number, c: Colour, alpha: number) => {
      const a = c.a * alpha;
      shapeData.set([x * dpr, y * dpr, c.r * a, c.g * a, c.b * a, a], n);
      n += 6;
    };
    for (const s of frame.shapes) {
      if (s.alpha <= 0) continue;
      const c = inkOf(s.ink);
      if (s.kind === "triangle") {
        const p = s.points;
        push(p[0], p[1], c, s.alpha);
        push(p[2], p[3], c, s.alpha);
        push(p[4], p[5], c, s.alpha);
      } else if (s.kind === "segment") {
        const dx = s.x1 - s.x0;
        const dy = s.y1 - s.y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (s.width / 2);
        const ny = (dx / len) * (s.width / 2);
        push(s.x0 + nx, s.y0 + ny, c, s.alpha);
        push(s.x1 + nx, s.y1 + ny, c, s.alpha);
        push(s.x1 - nx, s.y1 - ny, c, s.alpha);
        push(s.x0 + nx, s.y0 + ny, c, s.alpha);
        push(s.x1 - nx, s.y1 - ny, c, s.alpha);
        push(s.x0 - nx, s.y0 - ny, c, s.alpha);
      } else {
        const h = s.size / 2;
        push(s.x - h, s.y - h, c, s.alpha);
        push(s.x + h, s.y - h, c, s.alpha);
        push(s.x + h, s.y + h, c, s.alpha);
        push(s.x - h, s.y - h, c, s.alpha);
        push(s.x + h, s.y + h, c, s.alpha);
        push(s.x - h, s.y + h, c, s.alpha);
      }
    }
    if (n === 0) return;
    gl.useProgram(shapeProgram);
    gl.uniform2f(u.shapeRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindVertexArray(shapeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, shapeData.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n / 6);
  };

  return {
    kind: "webgl2",
    resize(width, height) {
      if (lost) return;
      gl.viewport(0, 0, width, height);
    },
    restyle(palette) {
      colours = palette;
    },
    draw(frame) {
      if (lost) return;
      const { view, dpr } = frame;
      ensureGrid(view, frame.quality);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(seaProgram);
      const state: SeaState = frame.state;
      gl.uniform1f(u.time, frame.t);
      gl.uniform1f(u.amp, definitionOf(state).amplitude);
      gl.uniform1f(u.maxAmp, declaredAmplitude(state));
      gl.uniform2f(u.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(u.horizon, view.horizon * dpr);
      gl.uniform1f(u.focal, view.focal * dpr);
      gl.uniform1f(u.point, (frame.quality === "high" ? 2.6 : 3.2) * dpr);
      gl.uniform4fv(u.pointColour, rgba(colours.point));
      gl.uniform4fv(u.crestColour, rgba(colours.crest));
      gl.bindVertexArray(seaVao);
      gl.drawArrays(gl.POINTS, 0, gridCount);
      drawShapes(frame);
      gl.bindVertexArray(null);
    },
    destroy() {
      canvas.removeEventListener?.("webglcontextlost", onLost);
      gl.deleteBuffer(seaBuffer);
      gl.deleteBuffer(shapeBuffer);
      gl.deleteVertexArray(seaVao);
      gl.deleteVertexArray(shapeVao);
      gl.deleteProgram(seaProgram);
      gl.deleteProgram(shapeProgram);
    },
  };
}
