import {
  AdditiveBlending, BoxGeometry, FrontSide, GLSL3, Mesh, ShaderMaterial, Vector3,
} from 'three';

// Trinity defines the volume bounds and the placement/phase/atlas inputs.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveBoosterUtilities.cpp#L25-L68
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EveBoosterSet.fxh
export function createFlameBox() {
  return new BoxGeometry(2, 2, 1).translate(0, 0, -0.5);
}

const vertexShader = `
out vec3 entryPoint;
void main() {
  entryPoint = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Local-space volume ray integration follows the approach in Three's VolumeShader.
// https://github.com/mrdoob/three.js/blob/r183/examples/jsm/shaders/VolumeShader.js
// The kernel, gain rows, width, noise response and mip selection are independent
// preview fits to controlled first-generation draws (source review 37).
const fragmentShader = `
precision highp sampler3D;
uniform sampler3D noiseMap;
uniform sampler2D shapeMap, gradientMap;
uniform vec3 localEye, flameColor, boosterScale, noiseFrequency, noiseStart, noiseEnd;
uniform float gain, time, phase, noiseSpeed, atlasCount, atlasIndex, atlasPixels;
in vec3 entryPoint;
out vec4 fragColor;

float distanceToWall(float origin, float direction, float low, float high) {
  if (direction == 0.0) return 1e20;
  float wall = direction > 0.0 ? high : low;
  return (wall - origin) / direction;
}

vec4 emissionAt(vec3 point, float gradientRow) {
  float depth = -point.z;
  vec3 frequency = noiseFrequency * boosterScale;
  vec3 noiseUV = point * frequency;
  noiseUV.z = phase + time * noiseSpeed - frequency.z * depth * depth * depth;
  vec3 displacement = (texture(noiseMap, noiseUV).rgb - 0.5) * mix(noiseStart, noiseEnd, depth);
  vec3 samplePoint = point + displacement;

  vec4 profile = textureLod(gradientMap, vec2(-samplePoint.z, gradientRow), 0.0);
  float radius = profile.a;
  if (radius <= 0.0 || !any(greaterThan(profile.rgb, vec3(0.0)))) return vec4(0.0);
  vec2 crossSection = samplePoint.xy / radius;
  if (any(greaterThan(abs(crossSection), vec2(1.0)))) return vec4(0.0);
  vec2 uv = 0.5 + 0.5 * crossSection;
  float inset = 0.5 / atlasPixels;
  uv.y = atlasIndex / atlasCount + mix(inset, 1.0 / atlasCount - inset, uv.y);
  float mip = 0.10 / (radius * radius);
  return textureLod(shapeMap, uv, mip) * profile;
}

void main() {
  // Front-face rasterization supplies the entry point. Only the nearest
  // forward wall is needed to determine the remaining distance in the box.
  vec3 direction = normalize(entryPoint - localEye);
  float travel = min(distanceToWall(entryPoint.x, direction.x, -1.0, 1.0),
                 min(distanceToWall(entryPoint.y, direction.y, -1.0, 1.0),
                     distanceToWall(entryPoint.z, direction.z, -1.0, 0.0)));
  if (travel <= 0.0) discard;
  vec3 segment = direction * travel;
  float row = mix(0.0625, 0.4375, clamp(gain / 2.0, 0.0, 1.0));
  const int samples = 12;
  vec4 total = vec4(0.0);
  for (int i = 0; i < samples; ++i) {
    vec3 point = entryPoint + segment * (float(i) / float(samples - 1));
    total += emissionAt(point, row);
  }
  float exposure = (2.0 / 3.0) * length(segment * boosterScale);
  vec4 emission = (total / float(samples)) * exposure;
  fragColor = vec4(max(vec3(0.0), emission.rgb * flameColor), emission.a);
}`;

export function createBoosterFlame(box, placement, parameters, textures, clock, thrust, phase) {
  const p = parameters;
  const material = new ShaderMaterial({
    glslVersion: GLSL3, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: FrontSide, blending: AdditiveBlending,
    uniforms: {
      localEye: { value: new Vector3() }, time: clock, gain: thrust, phase: { value: phase },
      shapeMap: { value: textures.ShapeMap }, gradientMap: { value: textures.GradientMap0 },
      noiseMap: { value: textures.NoiseMap },
      noiseStart: { value: new Vector3().fromArray(p.NoiseAmplitudeStart0) },
      noiseEnd: { value: new Vector3().fromArray(p.NoiseAmplitudeEnd0) },
      noiseFrequency: { value: new Vector3().fromArray(p.NoiseFrequency0) },
      noiseSpeed: { value: p.NoiseSpeed0[0] }, flameColor: { value: new Vector3().fromArray(p.Color0) },
      boosterScale: { value: new Vector3().fromArray(p.BoosterScale) },
      atlasIndex: { value: placement.atlasIndex0 },
      atlasPixels: { value: p.ShapeAtlasSize[0] }, atlasCount: { value: p.ShapeAtlasSize[1] },
    },
  });
  material.userData.eveBloomEmission = true;
  const mesh = new Mesh(box, material);
  mesh.matrixAutoUpdate = false;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.worldToLocal(material.uniforms.localEye.value.setFromMatrixPosition(camera.matrixWorld));
  };
  return mesh;
}
