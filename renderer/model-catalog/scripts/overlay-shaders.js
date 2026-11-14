// Object-linear projection uses dot products with two planes in rest space.
// https://registry.khronos.org/OpenGL-Refpages/gl2.1/xhtml/glTexGen.xml
// The preview uses DirectionU/V.xyz as axes and their w components as repeats
// per authored hull radius. Mesh-UV overlays need neither a radius nor a rest attribute.
const planarProjection = `
uniform vec4 DirectionU, DirectionV;
uniform float sourceRadius;
vec2 planarUV(vec3 restPosition) {
    vec3 unitPosition = restPosition / sourceRadius;
    return vec2(dot(unitPosition, DirectionU.xyz), dot(unitPosition, DirectionV.xyz))
         * vec2(DirectionU.w, DirectionV.w);
}`;

// The same Three vertex chunks that transform the hull also transform the overlay.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderLib/meshphysical.glsl.js
function overlayVertex(inputs, coordinates) {
  return `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
${inputs}
out vec2 layerUV;
out vec3 eyeVector, eyeNormal;
void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    layerUV = ${coordinates};
    eyeVector = -mvPosition.xyz;
    eyeNormal = transformedNormal;
}`;
}

export const uvEffectVertex = overlayVertex('', 'uv');
export const directionalVertex = overlayVertex(
  'in vec3 _ccp_source_position;\n' + planarProjection, 'planarUV(_ccp_source_position)');
export const attachmentOverlayVertex = overlayVertex(
  'uniform vec3 directionalScale;\n' + planarProjection, 'planarUV(position * directionalScale)');

// The source SOF provides the vectors and textures. Their use here is a local
// approximation of the effect. Scale, then translate, as in KHR_texture_transform.
// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md
// For the powered grazing-angle mask see Godot's VisualShaderNodeFresnel. The signed gain,
// angular bias, scrolling offsets and layer composition are preview conventions.
// https://github.com/godotengine/godot/blob/4.4/scene/resources/visual_shader_nodes.cpp#L6752-L6782
export const overlayFragment = `
in vec2 layerUV;
in vec3 eyeVector, eyeNormal;
uniform vec4 BaseColor, FresnelFactors;
uniform vec4 Layer1Transform, Layer2Transform, Layer1Scroll, Layer2Scroll;
uniform sampler2D Layer1Map, Layer2Map, LayerMaskMap;
uniform float time;
out vec4 fragColor;

vec2 scrollingUV(vec4 transform, vec4 scroll) {
    vec2 offset = transform.zw + scroll.zw + time * scroll.xy;
    return layerUV * transform.xy + offset;
}

float faceIntensity() {
    float cosine = dot(normalize(eyeVector), normalize(eyeNormal));
    float facing = clamp(cosine - FresnelFactors.z, 0.0, 1.0);
    float power = max(0.0, FresnelFactors.x);
    float rim = power > 0.0 ? pow(1.0 - facing, power) : 1.0;
    // Choose the complementary mask after shaping it. In the three 48920-22
    // fixtures inversion before power brightened almost the entire effect.
    return abs(FresnelFactors.y) * (FresnelFactors.y < 0.0 ? 1.0 - rim : rim);
}

void main() {
    vec4 layer1 = texture(Layer1Map, scrollingUV(Layer1Transform, Layer1Scroll));
    vec4 layer2 = texture(Layer2Map, scrollingUV(Layer2Transform, Layer2Scroll));
    vec4 maskedColor = BaseColor * texture(LayerMaskMap, layerUV) * layer1 * layer2;
    fragColor = vec4(maskedColor.rgb * faceIntensity(), maskedColor.a);
}`;
