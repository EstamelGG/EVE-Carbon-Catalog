import {OneMinusSrcAlphaFactor, Vector4} from 'three';

// Parameter meanings come from CCP EffectInfo artist annotations (stage 54).
// Three.js r183 map_fragment multiplies the sampled RGBA into the surface tint.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js
// modulate.xy are independent RGB and alpha gains for legacy texture multiplication.
// https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dtextureop
// Source and destination alpha influences use the sprite compositing model from stage 52.
// https://www.w3.org/TR/compositing-1/#porterduffcompositingoperators_srcover
export const spriteComposite = `
vec4 compositeSprite(vec4 pigment, vec4 factors) {
    vec3 emission = mix(pigment.rgb, pigment.a * pigment.rgb, factors.x);
    return vec4(emission, pigment.a * factors.z);
}`;

const fragment = `
in vec2 gateUV;
in vec4 gateTint;
out vec4 fragColor;
uniform sampler2D TexMapLayer1, TexMapLayer2;
uniform vec4 Layer1TexCoordModifier, Layer2TexCoordModifier, SpriteColor, SpriteFactors;
#ifdef SCROLLING_MASK
uniform vec4 Layer1TexCoordSpeed, Layer2TexCoordSpeed;
uniform sampler2D MaskMap;
uniform float elapsed;
#else
uniform vec4 modulate;
#endif

${spriteComposite}
void main() {
    vec2 firstUV = gateUV * Layer1TexCoordModifier.xy + Layer1TexCoordModifier.zw;
    vec2 secondUV = gateUV * Layer2TexCoordModifier.xy + Layer2TexCoordModifier.zw;
#ifdef SCROLLING_MASK
    firstUV += elapsed * Layer1TexCoordSpeed.xy;
    secondUV += elapsed * Layer2TexCoordSpeed.xy;
    // Project choice: mask both tint and coverage at the unscrolled sprite coordinates.
    vec4 mask = texture(MaskMap, gateUV);
    vec2 gain = vec2(1.0);
#else
    vec4 mask = vec4(1.0);
    vec2 gain = modulate.xy;
#endif
    vec4 layers = texture(TexMapLayer1, firstUV) * texture(TexMapLayer2, secondUV);
    vec4 pigment = layers * mask * (SpriteColor * gateTint);
    fragColor = compositeSprite(pigment, SpriteFactors) * gain.xxxy;
}`;

export async function layeredParticleMaterial(source, resources, vertex) {
  const scrolling = source.shader === '2layerdynmaskv2.fx';
  const controls = {
    SpriteColor: new Vector4(1, 1, 1, 1),
    SpriteFactors: new Vector4(1, 0, 1, 1),
    Layer1TexCoordModifier: new Vector4(1, 1, 0, 0),
    Layer2TexCoordModifier: new Vector4(1, 1, 0, 0),
  };
  if (scrolling) {
    controls.Layer1TexCoordSpeed = new Vector4(0, 0, 0, 0);
    controls.Layer2TexCoordSpeed = new Vector4(0, 0, 0, 0);
  } else {
    controls.modulate = new Vector4(1, 1, 1, 1);
  }

  const uniforms = Object.fromEntries(Object.entries(controls).map(([name, value]) => [name, {value}]));
  const slots = scrolling ? ['TexMapLayer1', 'TexMapLayer2', 'MaskMap'] : ['TexMapLayer1', 'TexMapLayer2'];
  for (const slot of slots) uniforms[slot] = {value: await resources.texture(source.textures[slot], {repeat: true})};
  if (scrolling) uniforms.elapsed = {value: 0};

  function update(parameters, time) {
    if (scrolling) uniforms.elapsed.value = time;
    for (const [name, vector] of Object.entries(controls)) {
      if (parameters[name]) vector.fromArray(parameters[name]);
    }
  }
  update(source.parameters, 0);
  const material = resources.additiveMaterial(vertex, fragment, uniforms);
  if (scrolling) material.defines.SCROLLING_MASK = 1;
  material.blendDst = OneMinusSrcAlphaFactor;
  return {material, update};
}
