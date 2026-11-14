// Trinity selects SOT_CLIP for authored decal areas in FillMeshAreaVector.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L796-L810
// Asset adapter: PaintMaskMap.r denotes removed coverage. Both viewer and export use glTF MASK.
// glTF MASK defines binary coverage. No public Trinity pixel shader was identified
// for this particular mask, UV convention or threshold.
// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#alpha-coverage
export function clipCoverage(red) {
  return `step(0.5, 1.0 - ${red})`;
}

export function applyCutoutShader(shader, clip, texture) {
  shader.uniforms.eve_clipMap = {value: texture};
  shader.uniforms.eve_clipUvMix = {value: clip.uvMix};
  shader.uniforms.eve_clipTiling = {value: clip.tiling};
  const secondary = clip.uvMix !== 0;
  shader.vertexShader = `varying vec2 eve_clipUv;
uniform float eve_clipUvMix, eve_clipTiling;
${secondary ? '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif' : ''}
` + shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
eve_clipUv=${secondary ? 'mix(uv,uv1,eve_clipUvMix)' : 'uv'}*eve_clipTiling;`);
  shader.fragmentShader = `varying vec2 eve_clipUv;
uniform sampler2D eve_clipMap;
` + shader.fragmentShader.replace('#include <alphatest_fragment>', `
if (${clipCoverage('texture2D(eve_clipMap,eve_clipUv).r')} == 0.0) discard;
#include <alphatest_fragment>`);
}
