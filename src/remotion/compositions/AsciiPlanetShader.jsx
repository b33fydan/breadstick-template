import React, { useCallback, useRef } from 'react';
import {
  AbsoluteFill,
  HtmlInCanvas,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// ─── 5×7 bitmap font (kept inline for self-containment) ─────────────────
const PIXEL_FONT_5x7 = {
  C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXX..', 'X....', 'X....', 'XXXXX'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

// ─── Shaders ────────────────────────────────────────────────────────────
// Full-screen quad. Y flipped so elementImage's top-down orientation aligns
// with WebGL's bottom-up texture sampling.
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// CRT post-process: barrel distortion + chromatic aberration + scanlines + vignette + bloom approx + phosphor tint.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);

  // Barrel distortion — mild CRT bow
  vec2 dUV = uv + cc * r2 * 0.18;

  // Black outside the warped frame (CRT bezel feel)
  if (dUV.x < 0.0 || dUV.x > 1.0 || dUV.y < 0.0 || dUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Chromatic aberration — R/B horizontal split, increasing toward edges
  float caAmount = 0.0025 + 0.006 * length(cc);
  vec3 col;
  col.r = texture(u_tex, dUV + vec2(caAmount, 0.0)).r;
  col.g = texture(u_tex, dUV).g;
  col.b = texture(u_tex, dUV - vec2(caAmount, 0.0)).b;

  // Scanlines — sinusoidal vertical modulation tied to resolution
  float scanY = dUV.y * u_resolution.y;
  float scan = 0.78 + 0.22 * sin(scanY * 1.4);
  col *= scan;

  // Vignette — radial darkening
  float vig = smoothstep(0.85, 0.30, length(cc));
  col *= vig;

  // Phosphor tint (slight blue/cyan cast)
  col *= vec3(0.92, 1.02, 1.10);

  // Bloom approximation — boost the brightest pixels
  vec3 bright = max(col - 0.55, 0.0);
  col += bright * 0.55;

  fragColor = vec4(col, 1.0);
}`;

// ─── Planet content (DOM — captured by HtmlInCanvas) ─────────────────────
//
// Spinning trick: the noise function used for `isLand` takes a `spinOffset`
// derived from `frame`. Shifting x in the noise input rotates which cells
// read as land vs ocean over time, while the bounding circle stays static.
// Result: continents appear to rotate across the visible disc, just like
// the Claude promo's ASCII Earth — *no actual rotation transform needed*.

const PlanetContent = ({ frame }) => {
  const enterDur = 30;
  const cols = 64;
  const rows = 28;
  const cx = cols / 2 - 0.5;
  const cy = rows / 2 - 0.5;
  const radius = 13;
  const dyStretch = 1.7;

  // Slow rotation — ~0.15 cells/frame at 24fps = 3.6 cells/second.
  // The noise function's primary period (sin x*0.18) is ~35 cells, so a
  // full "rotation" takes ~10 seconds. The 5.5s window shows ~half a turn.
  const spinOffset = frame * 0.15;

  const cellHash = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return ((v % 1) + 1) % 1;
  };

  const isLand = (x, y) => {
    const xRot = x + spinOffset;
    const n1 = Math.sin(xRot * 0.18 + 1.4) * Math.cos(y * 0.32);
    const n2 = Math.sin(xRot * 0.08 + y * 0.21 + 2.7) * 0.85;
    const n3 = Math.cos(xRot * 0.27 + y * 0.16) * 0.4;
    return (n1 + n2 + n3) > 0.25;
  };

  const scanRow = interpolate(frame, [0, enterDur], [-1, rows + 2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const dx = x - cx;
      const dy = (y - cy) * dyStretch;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) { line += ' '; continue; }
      if (y > scanRow) { line += ' '; continue; }
      const distNorm = Math.sqrt(distSq) / radius;
      const land = isLand(x, y);
      // Cell hash also rotates so individual cells "flicker" as they pass —
      // sells the spinning effect more than a static glyph map would.
      const h = cellHash(x + Math.floor(spinOffset), y);
      if (distNorm > 0.94) { line += h < 0.5 ? '·' : ' '; continue; }
      if (land) line += h < 0.85 ? '/' : 'X';
      else line += h < 0.42 ? '/' : (h < 0.55 ? '·' : ' ');
    }
    lines.push(line);
  }

  // Pin animations
  const sfPinOp = interpolate(frame, [enterDur + 4, enterDur + 16], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const lonPinOp = interpolate(frame, [enterDur + 14, enterDur + 26], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const arcProg = interpolate(frame, [enterDur + 22, enterDur + 50], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const fontSize = 22;
  const charW = fontSize * 0.6;
  const lineH = fontSize * 1.0;
  const planetW = cols * charW;
  const planetH = rows * lineH;

  const sfPx = { x: cols * 0.32 * charW, y: rows * 0.40 * lineH };
  const lonPx = { x: cols * 0.66 * charW, y: rows * 0.36 * lineH };
  const arcMidX = (sfPx.x + lonPx.x) / 2;
  const arcMidY = Math.min(sfPx.y, lonPx.y) - 90;
  const arcPath = `M ${sfPx.x} ${sfPx.y} Q ${arcMidX} ${arcMidY} ${lonPx.x} ${lonPx.y}`;
  const arcLen = 800;

  return (
    <div style={{ position: 'relative', width: planetW, height: planetH }}>
      <div style={{
        position: 'absolute', left: 0, top: -64, width: '100%',
        textAlign: 'center',
        fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: 22,
        letterSpacing: '0.22em', color: '#00C8FF', textTransform: 'uppercase',
        textShadow: '0 0 12px rgba(0,200,255,0.55)',
      }}>
        Code w/ Claude · Global
      </div>

      <pre style={{
        position: 'relative',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: fontSize, lineHeight: 1.0,
        color: 'rgba(245, 245, 245, 0.94)', letterSpacing: 0,
        margin: 0, padding: 0,
        textShadow: '0 0 6px rgba(0,200,255,0.18)',
        whiteSpace: 'pre',
      }}>
        {lines.join('\n')}
      </pre>

      <svg style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', overflow: 'visible',
      }}>
        <path d={arcPath} fill="none" stroke="#E08855" strokeWidth="3"
          strokeDasharray={`${arcLen} ${arcLen}`}
          strokeDashoffset={`${arcLen * (1 - arcProg)}`}
          opacity={arcProg > 0 ? 0.95 : 0} />
      </svg>

      <div style={{
        position: 'absolute', left: sfPx.x, top: sfPx.y,
        opacity: sfPinOp, transform: 'translate(-50%, -100%)',
        fontFamily: 'Consolas, "Courier New", monospace',
      }}>
        <div style={{
          background: '#E08855', color: '#fff',
          padding: '4px 12px', fontSize: 18, fontWeight: 700,
          letterSpacing: '0.02em', borderRadius: 4,
          boxShadow: '0 4px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>San Francisco</div>
        <div style={{ width: 2, height: 18, background: '#E08855', margin: '0 auto' }} />
        <div style={{
          width: 12, height: 12, borderRadius: '50%', background: '#E08855',
          margin: '0 auto', marginTop: -3,
          boxShadow: '0 0 12px rgba(224, 136, 85, 0.95)',
        }} />
      </div>

      <div style={{
        position: 'absolute', left: lonPx.x, top: lonPx.y,
        opacity: lonPinOp, transform: 'translate(-50%, -100%)',
        fontFamily: 'Consolas, "Courier New", monospace',
      }}>
        <div style={{
          background: '#E08855', color: '#fff',
          padding: '4px 12px', fontSize: 18, fontWeight: 700,
          letterSpacing: '0.02em', borderRadius: 4,
          boxShadow: '0 4px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>London</div>
        <div style={{ width: 2, height: 18, background: '#E08855', margin: '0 auto' }} />
        <div style={{
          width: 12, height: 12, borderRadius: '50%', background: '#E08855',
          margin: '0 auto', marginTop: -3,
          boxShadow: '0 0 12px rgba(224, 136, 85, 0.95)',
        }} />
      </div>
    </div>
  );
};

// ─── Master composition with HtmlInCanvas + WebGL CRT shader ────────────
export const AsciiPlanetShader = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stateRef = useRef(null);

  const onInit = useCallback(({ canvas }) => {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) {
      console.error('WebGL2 not available');
      return;
    }

    const compileShader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // Full-screen triangle strip
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const uTex = gl.getUniformLocation(program, 'u_tex');
    const uRes = gl.getUniformLocation(program, 'u_resolution');

    stateRef.current = { gl, program, vao, vbo, tex, uTex, uRes };

    return () => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteTexture(tex);
    };
  }, []);

  const onPaint = useCallback(({ canvas, element, elementImage }) => {
    if (!stateRef.current) return;
    const { gl, program, vao, tex, uTex, uRes } = stateRef.current;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elementImage);

    gl.uniform1i(uTex, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Identity transform — DOM selection alignment isn't critical for our render path.
    if (element && element.style) {
      element.style.transform = 'matrix(1, 0, 0, 1, 0, 0)';
    }
  }, []);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <HtmlInCanvas width={width} height={height} onInit={onInit} onPaint={onPaint}>
        <AbsoluteFill style={{
          background: '#0a0a0f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <PlanetContent frame={frame} />
        </AbsoluteFill>
      </HtmlInCanvas>
    </AbsoluteFill>
  );
};
