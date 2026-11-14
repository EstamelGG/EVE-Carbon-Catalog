import {OneMinusSrcAlphaFactor, Vector4} from 'three';

// Controls are decoded from CCP's named artist annotations. See the input values and
// the independent comparisons in docs/source-remediation-52-evidence.json.
// Atlas addressing: Godot 4.4 BaseMaterial3D, particle billboard frame selection.
// https://github.com/godotengine/godot/blob/4.4/scene/resources/material.cpp
// Compositing: https://www.w3.org/TR/compositing-1/#porterduffcompositingoperators_srcover
const fragment = `
in vec2 gateUV;
in float gateTile;
in vec4 gateTint;
uniform sampler2D atlas;
uniform vec4 uvTransform;
uniform vec4 spriteColor;
uniform vec4 spriteFactors;
out vec4 fragColor;

void main() {
    float columns = max(1.0, floor(spriteFactors.w));
    float frame = clamp(floor(gateTile), 0.0, columns * columns - 1.0);
    vec2 cell = vec2(mod(frame, columns), floor(frame / columns));
    vec2 localUV = fract(gateUV * uvTransform.xy + uvTransform.zw);
    vec4 sampleColor = texture(atlas, (cell + localUV) / columns) * gateTint * spriteColor;

    // Crossfade unattenuated emission and premultiplied source-over.
    // Artists control how much coverage dims the source and the backdrop independently.
    vec3 premultiplied = sampleColor.rgb * sampleColor.a;
    vec3 emission = mix(sampleColor.rgb, premultiplied, spriteFactors.x);
    fragColor = vec4(emission, sampleColor.a * spriteFactors.z);
}`;

export async function atlasParticleMaterial(source, resources, vertex) {
  const uniforms = {
    atlas: {value: await resources.texture(source.textures.TexMapLayer1, {repeat: true})},
    uvTransform: {value: new Vector4(1, 1, 0, 0)},
    spriteColor: {value: new Vector4(1, 1, 1, 1)},
    spriteFactors: {value: new Vector4(1, 0, 1, 1)},
  };
  function update(parameters) {
    if (parameters.SpriteColor) uniforms.spriteColor.value.fromArray(parameters.SpriteColor);
    if (parameters.SpriteFactors) uniforms.spriteFactors.value.fromArray(parameters.SpriteFactors);
    if (parameters.Layer1TexCoordModifier) uniforms.uvTransform.value.fromArray(parameters.Layer1TexCoordModifier);
  }
  update(source.parameters);
  const material = resources.additiveMaterial(vertex, fragment, uniforms);
  material.blendDst = OneMinusSrcAlphaFactor;
  return {material, update};
}
