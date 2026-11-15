import { LinearSRGBColorSpace, SRGBColorSpace, Vector4 } from 'three';
import { displayDecode } from './lighting-shaders.js';

// The facing-power model also occurs in Godot's VisualShaderNodeFresnel.
// Signed intensity and bias are our compatibility interpretation of the asset.
// https://github.com/godotengine/godot/blob/4.4/scene/resources/visual_shader_nodes.cpp
export const facingProfile = `
float facingIntensity(float cosine, vec4 factors) {
  float grazing = clamp(1.0 - (cosine - factors.z), 0.0, 1.0);
  float rim = factors.x == 0.0 ? 1.0 : pow(grazing, factors.x);
  float profile = factors.y < 0.0 ? max(0.0, 1.0 - rim) : rim;
  return abs(factors.y) * profile;
}`;

function vertex(perVertex) {
  return `
out vec2 beamUV;
${perVertex ? `out float vertexGain;
uniform vec4 FresnelFactors;
${facingProfile}` : 'out vec3 eyeDirection, surfaceNormal;'}
void main() {
  vec4 point = modelViewMatrix * vec4(position, 1.0);
  vec3 eye = normalize(-point.xyz);
  vec3 normalView = normalize(normalMatrix * normal);
  beamUV = uv;
  ${perVertex ? 'vertexGain = facingIntensity(dot(eye, normalView), FresnelFactors);' :
    'eyeDirection = eye; surfaceNormal = normalView;'}
  gl_Position = projectionMatrix * point;
}`;
}

export const regularVertex = vertex(false);
export const twoSidedVertex = vertex(true);

// KHR_texture_transform specifies scaling followed by translation.
// The scroll velocity and phase come from the two halves of TextureScrollN.
// https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_transform
export const layerCoordinates = `vec2 layerUV(vec2 uv, vec4 transform, vec4 scroll) {
  return uv * transform.zw + (transform.xy + scroll.zw + time * scroll.xy);
}`;

function layerSampling(layers, maskTransform, hasMask) {
  return `
uniform float time;
${hasMask ? 'uniform sampler2D MaskMap;' : ''}
${maskTransform ? 'uniform vec4 MaskTransform, MaskScroll;' : ''}
${layers.map(i => `uniform sampler2D DiffuseMap${i};
uniform vec4 TextureTransform${i}, TextureScroll${i};`).join('\n')}
${layerCoordinates}
vec4 sampleLayers(vec2 uv) {
  vec4 transmission = ${hasMask ? `texture(MaskMap, ${maskTransform ? 'layerUV(uv, MaskTransform, MaskScroll)' : 'uv'})` : 'vec4(1.0)'};
  ${layers.map(i => `transmission *= texture(DiffuseMap${i}, layerUV(uv, TextureTransform${i}, TextureScroll${i}));`).join('\n  ')}
  return transmission;
}`;
}

function fragment(layers, maskTransform, perVertex) {
  return `
in vec2 beamUV;
${perVertex ? 'in float vertexGain;' : `in vec3 eyeDirection, surfaceNormal;
uniform vec4 FresnelFactors;
${facingProfile}`}
uniform vec4 DiffuseColor;
out vec4 fragColor;
${layerSampling(layers, maskTransform, true)}
void main() {
  vec3 transmission = sampleLayers(beamUV).rgb;
  float gain = ${perVertex ? 'vertexGain' : 'facingIntensity(dot(eyeDirection, surfaceNormal), FresnelFactors)'};
  vec3 radiance = max(transmission, vec3(0.0)) * DiffuseColor.rgb * gain;
  fragColor = vec4(radiance, 0.0);
}`;
}

// Gate manifests store the compiled option table as an object. Older equipment
// exports carry name/value pairs; two-sided effects can have no static options.
export function gateLayerOptions(record) {
  return Array.isArray(record.options) ? Object.fromEntries(record.options) : record.options || {};
}

export function gateLayerFragment(record, carrier = false) {
  const options = gateLayerOptions(record);
  const textures = record.textures || {};
  const count = { ONE: 1, TWO: 2, THREE: 3 }[options.DIFFUSE_MAP_COUNT] ?? 3;
  const layers = [1, 2, 3].filter(i => i <= count && textures['DiffuseMap' + i]);
  const twoSided = record.shader === 'ubershadertwosided.fx';
  const additive = record.blend === 'additiveAreas';
  // The gate compatibility profile interpolates the two-sided cosine before
  // applying the exponent. The carrier also fades its coverage.
  // Resource annotation and active-frame comparisons: remediation 70.
  return `
in vec2 gateUV;
${twoSided ? 'in float facing;' : 'in vec3 gateEye, gateNormal;'}
uniform vec4 DiffuseColor, FresnelFactors;
out vec4 fragColor;
${layerSampling(layers, options.MASK_TRANSFORM === 'ON', Boolean(textures.MaskMap))}
${facingProfile}
${carrier ? `uniform sampler2D carrierFrame;
uniform vec2 carrierSize;
uniform bool carrierLinear;
${displayDecode}
vec3 carrierToDisplay(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}` : ''}
void main() {
  vec4 layers = sampleLayers(gateUV);
  vec4 factors = FresnelFactors;
  factors.x = max(factors.x, 0.0001);
  float gain = facingIntensity(${twoSided ? 'facing' : 'dot(gateEye, gateNormal)'}, factors);
  vec3 radiance = max(layers.rgb, vec3(0.0)) * DiffuseColor.rgb * gain;
  float coverage = layers.a * DiffuseColor.a;
  ${carrier ? `vec3 behind = texture(carrierFrame, gl_FragCoord.xy / carrierSize).rgb;
  if (carrierLinear) behind = carrierToDisplay(behind);
  vec3 combined = ${record.blend === 'transparentAreas' ? 'mix(behind, radiance, clamp(coverage * gain, 0.0, 1.0))' : 'behind + radiance'};
  fragColor = vec4(carrierLinear ? sourceDisplayToLinear(max(combined, vec3(0.0))) : combined, 1.0);`
  : `fragColor = vec4(radiance, ${additive ? '0.0' : 'coverage'});`}
}`;
}

// Layered effects multiply RGB for emission and sample alpha independently.
// A projected color atlas is sometimes bound to MaskMap on a second mesh.
export function diffuseAtlases(materials) {
  const urls = new Set();
  for (const material of materials) {
    for (const [slot, source] of Object.entries(material?.textures ?? {})) {
      if (/^DiffuseMap[1-4]$/.test(slot) && source?.url) urls.add(source.url);
    }
  }
  return urls;
}

export function layeredTexture(source, slot, colorAtlases) {
  if (source.colorSpace !== undefined || source.video || source.float32 || source.volume || source.cube) return source;
  if (source.sourceTransfer === 'linear') return { ...source, colorSpace: LinearSRGBColorSpace };
  if (source.sourceTransfer === 'srgb' || /^DiffuseMap[1-4]$/.test(slot) ||
      (/^MaskMap[12]?$/.test(slot) && colorAtlases?.has(source.url))) {
    return { ...source, colorSpace: SRGBColorSpace };
  }
  return source;
}

export async function createLayeredMeshMaterial(record, resources, layerCount, colorAtlases) {
  const layers = Array.from({ length: layerCount }, (_, i) => i + 1);
  const uniforms = { time: { value: 0 } };
  function vector(name, fallback) {
    uniforms[name] = { value: new Vector4().fromArray(record.parameters[name] ?? fallback) };
  }
  function coordinates(transform, scroll) {
    vector(transform, [0, 0, 1, 1]);
    vector(scroll, [0, 0, 0, 0]);
  }
  vector('DiffuseColor', [1, 1, 1, 1]);
  vector('FresnelFactors', [1, 1, 0, 0]);
  if (record.maskTransform) coordinates('MaskTransform', 'MaskScroll');
  for (const i of layers) coordinates('TextureTransform' + i, 'TextureScroll' + i);
  await Promise.all(['MaskMap', ...layers.map(i => 'DiffuseMap' + i)].map(async name => {
    const repeat = name !== 'MaskMap' || !record.maskClamp;
    const source = record.textures[name];
    uniforms[name] = { value: await resources.texture(layeredTexture(source, name, colorAtlases), { repeat }) };
  }));
  return resources.additiveMaterial(record.twoSided ? twoSidedVertex : regularVertex,
    fragment(layers, record.maskTransform, record.twoSided), uniforms);
}
