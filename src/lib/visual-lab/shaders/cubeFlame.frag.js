export const cubeFlameFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uHoloShift;

  varying float vLife;
  varying float vAlpha;
  varying float vVariation;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  vec3 threeStopGradient(float position) {
    float lowerMix = smoothstep(0.02, 0.52, position);
    float upperMix = smoothstep(0.45, 0.98, position);
    return mix(mix(uColorA, uColorB, lowerMix), uColorC, upperMix);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(vViewDirection);
    vec3 lightDirection = normalize(vec3(-0.38, 0.72, 0.58));

    float facing = max(dot(normal, viewDirection), 0.0);
    float fresnel = pow(1.0 - facing, 2.35);
    float keyLight = 0.34 + max(dot(normal, lightDirection), 0.0) * 0.78;
    float spectralPhase = vWorldPosition.y * 2.8
      + vVariation * 6.28318530718
      + fresnel * 2.1;
    float spectralBand = 0.5 + 0.5 * sin(spectralPhase);

    vec3 gradient = threeStopGradient(vLife);
    vec3 spectral = mix(uColorC, uColorA, spectralBand);
    spectral = mix(spectral, uColorB, 0.28 + 0.2 * sin(spectralPhase * 1.7));
    vec3 color = mix(gradient, spectral, uHoloShift * (0.16 + fresnel * 0.42));

    float crystallineEdge = 0.68 + fresnel * 1.45;
    float innerGlint = pow(max(dot(normal, normalize(vec3(0.2, 0.82, 0.53))), 0.0), 8.0);
    color *= keyLight * crystallineEdge + innerGlint * 0.85;
    color += gradient * fresnel * 0.58;

    float alpha = vAlpha * (0.62 + fresnel * 0.38);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export default cubeFlameFragmentShader;
