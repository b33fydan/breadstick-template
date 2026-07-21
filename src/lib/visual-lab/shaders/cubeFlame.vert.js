export const cubeFlameVertexShader = /* glsl */ `
  attribute float instanceLife;
  attribute float instanceAlpha;
  attribute float instanceVariation;

  varying float vLife;
  varying float vAlpha;
  varying float vVariation;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;

  void main() {
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    vec4 worldPosition = modelMatrix * instancePosition;
    mat3 instanceNormalMatrix = mat3(modelMatrix) * mat3(instanceMatrix);

    vLife = instanceLife;
    vAlpha = instanceAlpha;
    vVariation = instanceVariation;
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(instanceNormalMatrix * normal);
    vViewDirection = cameraPosition - worldPosition.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export default cubeFlameVertexShader;
