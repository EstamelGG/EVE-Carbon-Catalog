// SOURCE AUDIT 2026-11-11 [B05/M01-M04]: Publication/export reuses unresolved native material semantics; standard APIs do not clear those semantics.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
import {Camera, CanvasTexture, DoubleSide, Mesh, NoBlending, NoColorSpace, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, WebGLRenderer, WebGLRenderTarget} from 'three';
import {runtimeUniforms, runtimeDeclarations, runtimeComposition} from './runtime-material.js';
import {patternRoles, patternVertex} from './projected-patterns.js';
import {clipCoverage} from './material-cutout.js';
import {normalExpression} from './material-normal.js';
import {hasDetail} from './detail-material.js';
import {hasEnvironment} from './environment-material.js';
import {configureGlass, glassMaskExpression, isGlassMaterial} from './glass-material.js';
import {glowMaskExpression, glowResponseGLSL} from './native-surface-response.js';

// Use exactly the viewer's material composition, with lighting removed. glTF
// cannot carry onBeforeCompile, so uncoloured runtime inputs are not a fallback.
export function bakeShader(recipe, mode, projected = false) {
  const {native, loaded, dirtLevel, displayUniforms} = recipe;
  const roles = projected ? patternRoles(native) : [];
  const patterns = roles.length;
  const projection = patternVertex(patterns);
  const uniforms = {...runtimeUniforms(native, loaded, dirtLevel), map:{value:loaded.AlbedoMap}};
  uniforms.eve_dirtStrength.value=recipe.dirtStrength?.value??1;
  for (const [name, uniform] of Object.entries(displayUniforms || {})) uniforms[name] = {value:uniform.value};
  const clip = native.clip;
  const glass = isGlassMaterial(native);
  // The glass export uses its separate, existing tint approximation. Opaque
  // glTF has one roughness, so approximate the two lobes by their mean GGX alpha.
  const color = glass || recipe.opaqueQuadHull
    ? 'diffuseColor.rgb*pow(1.0-eveRuntimeDust.b,3.0)+eveRuntimeDustBase*eveRuntimeDust.b'
    : 'mix(diffuseColor.rgb,eveRuntimeDustBase,eveRuntimeDust.b)';
  const alpha = glass ? 'eveAlpha' : 'mix(eveAlpha,eveRuntimeDust.r,eveRuntimeDust.b)';
  const output = {
    color: `vec4(encodeSRGB(${color}),coverage)`,
    roughness: `vec4(0.0,sqrt(${alpha}),0.0,1.0)`,
    normal: `vec4(${normalExpression(native,'eve_NormalMap','vMapUv')}*0.5+0.5,1.0)`,
    glow: `vec4(encodeSRGB(vec3(${glowMaskExpression})),1.0)`,
  }[mode];
  if (!output) throw new Error('Unknown material bake output');
  return {
    defines: recipe.opaqueQuadHull ? {EVE_OPAQUE_QUAD_HULL: 1} : {},
    uniforms, side:DoubleSide, depthTest:false, depthWrite:false, blending:NoBlending,
    vertexShader:`varying vec2 vMapUv;
      ${clip?.uvMix && projected ? 'attribute vec2 uv1; varying vec2 clipUV;' : ''}
      ${patterns ? projection.declarations : ''}
      void main(){vMapUv=uv;
        ${clip?.uvMix && projected ? 'clipUV=uv1;' : ''}
        ${patterns ? projection.body : ''}
        gl_Position=vec4(uv*2.0-1.0,0.0,1.0);}`,
    fragmentShader:`varying vec2 vMapUv; uniform sampler2D map, eve_NormalMap;
      ${clip?.uvMix && projected ? 'varying vec2 clipUV;' : ''}
      ${runtimeDeclarations(!!loaded.SailsDetailMap, patterns, hasDetail(native), hasEnvironment(native), roles)}
      ${mode === 'glow' ? glowResponseGLSL(glass) : ''}
      vec3 encodeSRGB(vec3 value){value=clamp(value,0.0,1.0);
        return mix(value*12.92,1.055*pow(value,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),value));}
      void main(){vec4 diffuseColor=vec4(1.0); ${runtimeComposition(!!loaded.SailsDetailMap, patterns, hasDetail(native), hasEnvironment(native), roles)}
        float coverage=${glass ? `1.0-(${glassMaskExpression})` : '1.0'};
        ${clip ? `coverage*=${clipCoverage(`texture2D(eve_PaintMaskMap,${clip.uvMix && projected ? `mix(vMapUv,clipUV,${Number(clip.uvMix).toFixed(8)})` : 'vMapUv'}*${Number(clip.tiling).toFixed(8)}).r`)};` : ''}
        gl_FragColor=${output};}`,
  };
}

export function createMaterialBaker() {
  const renderer = new WebGLRenderer({antialias:false, alpha:true});
  const scene = new Scene(), camera = new Camera(), quad = new PlaneGeometry(2,2);
  const textures = [], materials = [], cache = new Map();
  let shaderError;
  renderer.debug.onShaderError = () => { shaderError = new Error('Unable to bake native material shader'); };
  function texture(recipe, mode, mesh, sourceMaterial) {
    const source = mode === 'glow' && recipe.loaded.GlowMap ? recipe.loaded.GlowMap : recipe.loaded.AlbedoMap;
    const image = source.image;
    const mask = mode === 'color' && isGlassMaterial(recipe.native) ? recipe.loaded.PaintMaskMap?.image : null;
    const width = Math.min(Math.max(image.width, mask?.width || 0), renderer.capabilities.maxTextureSize);
    const height = Math.min(Math.max(image.height, mask?.height || 0), renderer.capabilities.maxTextureSize);
    const target = new WebGLRenderTarget(width, height, {depthBuffer:false, stencilBuffer:false});
    const draw = (geometry, projected) => {
      const shader = new ShaderMaterial(bakeShader(recipe, mode, projected));
      const object = new Mesh(geometry, shader); object.frustumCulled = false;
      scene.add(object);
      try { renderer.render(scene, camera); if (shaderError) throw shaderError; }
      finally { scene.remove(object); shader.dispose(); }
    };
    try {
      renderer.setRenderTarget(target); renderer.setClearColor(0,0); renderer.clear();
      // Fill the complete texture first, including UV island borders. Projection
      // is then evaluated on native rest positions rather than on posed vertices.
      draw(quad, false);
      if ((recipe.native.patterns?.length || recipe.native.clip?.uvMix) && ['color','roughness'].includes(mode)) {
        const geometry = mesh.geometry.clone();
        try {
          if (Array.isArray(mesh.material)) {
            const indices = [];
            for (const group of geometry.groups) if (mesh.material[group.materialIndex] === sourceMaterial) {
              for (let i=group.start; i<group.start+group.count; i++) indices.push(geometry.index?.getX(i) ?? i);
            }
            geometry.setIndex(indices); geometry.clearGroups();
          }
          draw(geometry, true);
        } finally { geometry.dispose(); }
      }
      const pixels = new Uint8Array(width*height*4);
      renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
      const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer),width,height),0,0);
      const result = new CanvasTexture(canvas);
      result.flipY=false; result.colorSpace=['color','glow'].includes(mode) ? SRGBColorSpace : NoColorSpace;
      result.wrapS=source.wrapS; result.wrapT=source.wrapT;
      result.name=`Baked ${sourceMaterial.name} ${mode}`; textures.push(result); return result;
    } finally { renderer.setRenderTarget(null); target.dispose(); }
  }
  return {
    material(mesh, sourceMaterial, fallback, recipe) {
      const projected = recipe.native.patterns?.length || recipe.native.clip?.uvMix;
      const key = `${sourceMaterial.uuid}/${projected ? mesh.geometry.uuid : ''}`;
      if (cache.has(key)) return cache.get(key);
      const material = fallback.clone(); materials.push(material);
      material.color.setRGB(1,1,1); material.map=texture(recipe,'color',mesh,sourceMaterial);
      material.metalness=0; material.metalnessMap=null;
      material.roughness=1; material.roughnessMap=texture(recipe,'roughness',mesh,sourceMaterial);
      if (recipe.loaded.NormalMap && recipe.displayUniforms?.eve_useNormalMap?.value !== 0) {
        material.normalMap=texture(recipe,'normal',mesh,sourceMaterial); material.normalScale.set(1,1);
      } else material.normalMap=null;
      const glow = recipe.native.parameters.GeneralGlowColor || recipe.native.parameters.GeneralHeatGlowColor || [0,0,0];
      const intensity = Math.max(1,...glow.slice(0,3));
      material.emissive.setRGB(...glow.slice(0,3).map(value=>value/intensity)); material.emissiveIntensity=intensity;
      if (glow.slice(0,3).some(value=>value>0)) material.emissiveMap=texture(recipe,'glow',mesh,sourceMaterial);
      if (isGlassMaterial(recipe.native)) configureGlass(material);
      else if (recipe.native.clip) { material.alphaTest=0.5; material.transparent=false; }
      cache.set(key,material); return material;
    },
    dispose() {
      textures.forEach(texture=>texture.dispose()); materials.forEach(material=>material.dispose());
      quad.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
