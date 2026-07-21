export const ditherVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ditherFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform float uAmount;
  uniform float uPixelScale;
  uniform float uPosterize;
  uniform int uMode;

  varying vec2 vUv;

  float bayer2(vec2 pixel) {
    vec2 p = mod(floor(pixel), 2.0);
    if (p.y < 0.5) return p.x < 0.5 ? 0.0 : 2.0;
    return p.x < 0.5 ? 3.0 : 1.0;
  }

  float bayer4(vec2 pixel) {
    return 4.0 * bayer2(mod(pixel, 2.0))
      + bayer2(floor(pixel / 2.0));
  }

  float bayer8(vec2 pixel) {
    return 16.0 * bayer2(mod(pixel, 2.0))
      + 4.0 * bayer2(mod(floor(pixel / 2.0), 2.0))
      + bayer2(floor(pixel / 4.0));
  }

  float stableNoise(vec2 pixel) {
    vec2 p = floor(pixel);
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec4 source = texture2D(tDiffuse, vUv);
    if (source.a <= 0.0 || uAmount <= 0.001) {
      gl_FragColor = source;
      return;
    }

    vec2 pixel = gl_FragCoord.xy / max(1.0, uPixelScale);
    float threshold;
    if (uMode == 1) {
      threshold = (bayer8(pixel) + 0.5) / 64.0;
    } else if (uMode == 2) {
      threshold = stableNoise(pixel);
    } else {
      threshold = (bayer4(pixel) + 0.5) / 16.0;
    }
    threshold -= 0.5;

    float levels = max(2.0, uPosterize);
    vec3 shifted = max(vec3(0.0), source.rgb + threshold / levels);
    vec3 quantized = floor(shifted * (levels - 1.0) + 0.5) / (levels - 1.0);
    gl_FragColor = vec4(mix(source.rgb, quantized, uAmount), source.a);
  }
`;

export default ditherFragmentShader;
