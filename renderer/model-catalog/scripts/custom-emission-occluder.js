import {
  Material, ShaderMaterial, RawShaderMaterial,
  AddEquation,
  AdditiveBlending,
  CustomBlending,
  DstColorFactor,
  ReverseSubtractEquation,
  SubtractEquation,
  MaxEquation,
  MinEquation,
  MultiplyBlending,
  NoBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  SubtractiveBlending,
  ZeroFactor,
} from 'three';

// Keep the original shader, including displacement, discard and source alpha.
// The emission buffer receives only the destination term of RGB blending.
export function customEmissionOccluder(source) {
  // ShaderMaterial.copy deep-clones every uniform texture. Transient renderer
  // textures can have no mips to clone, and this pass needs the live bindings.
  const material = source.isRawShaderMaterial ? new RawShaderMaterial() : new ShaderMaterial();
  Material.prototype.copy.call(material,source);
  for(const name of ['vertexShader','fragmentShader','uniforms','uniformsGroups','defines',
    'wireframe','wireframeLinewidth','lights','clipping','extensions','glslVersion',
    'defaultAttributeValues','index0AttributeName','uniformsNeedUpdate'])material[name]=source[name];
  material.customProgramCacheKey = () => source.customProgramCacheKey() + ':emission-occluder';
  refreshCustomOccluder(source, material);
  return material;
}
export function refreshCustomOccluder(source, material) {
  // Shader uniforms and dynamic render-state edits are live across frames.
  for (const field of [
    'side',
    'depthTest',
    'depthWrite',
    'depthFunc',
    'colorWrite',
    'visible',
    'transparent',
    'opacity',
    'stencilWrite',
    'stencilWriteMask',
    'stencilFunc',
    'stencilRef',
    'stencilFuncMask',
    'stencilFail',
    'stencilZFail',
    'stencilZPass',
    'polygonOffset',
    'polygonOffsetFactor',
    'polygonOffsetUnits',
    'premultipliedAlpha',
    'alphaTest',
    'alphaHash',
    'alphaToCoverage',
    'forceSinglePass',
    'blendAlpha',
  ])
    material[field] = source[field];
  material.blendColor.copy(source.blendColor);
  material.uniforms = source.uniforms;
  material.onBeforeCompile = source.onBeforeCompile;
  material.onBeforeRender = source.onBeforeRender;
  material.blending = CustomBlending;
  material.blendSrc = ZeroFactor;
  material.blendEquation = AddEquation;
  if (source.blending === CustomBlending) {
    material.blendDst = source.blendDst;
    if (source.blendEquation === SubtractEquation) material.blendEquation = SubtractEquation;
    if (source.blendEquation === ReverseSubtractEquation)
      material.blendEquation = ReverseSubtractEquation;
    // Keep the original alpha function even when RGB uses different factors.
    material.blendSrcAlpha = source.blendSrcAlpha ?? source.blendSrc;
    material.blendDstAlpha = source.blendDstAlpha ?? source.blendDst;
    material.blendEquationAlpha = source.blendEquationAlpha ?? source.blendEquation;
    // Min/max are color comparisons, with no separable destination term.
    // The preview treats them as straight coverage for untagged surfaces.
    if (source.blendEquation === MinEquation || source.blendEquation === MaxEquation)
      material.blendDst = OneMinusSrcAlphaFactor;
  } else {
    const mode =
      source.blending === NormalBlending && !source.transparent ? NoBlending : source.blending;
    material.blendDst =
      mode === NoBlending
        ? ZeroFactor
        : mode === AdditiveBlending
          ? OneFactor
          : mode === SubtractiveBlending
            ? OneMinusSrcColorFactor
            : OneMinusSrcAlphaFactor;
    if (mode === MultiplyBlending) material.blendSrc = DstColorFactor;
    material.blendSrcAlpha =
      mode === SubtractiveBlending || mode === MultiplyBlending ? ZeroFactor : OneFactor;
    material.blendDstAlpha =
      mode === NoBlending
        ? ZeroFactor
        : mode === NormalBlending
          ? OneMinusSrcAlphaFactor
          : OneFactor;
    material.blendEquationAlpha = AddEquation;
  }
  return material;
}
