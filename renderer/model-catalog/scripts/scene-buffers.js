import {architectureBufferSignature} from './architecture-buffer.js';
import {renderPreparedScene} from './prepared-scene.js';
import {Color,DepthTexture,HalfFloatType,LinearFilter,Matrix4,MeshBasicMaterial,NoToneMapping,Vector4,WebGLRenderTarget} from 'three';

const providers=new WeakMap();
export function registerSceneBuffers(scene,provider){
  if(providers.has(scene))throw Error('Scene buffers already installed');
  providers.set(scene,provider);
  return ()=>{if(providers.get(scene)===provider)providers.delete(scene);};
}
export function sceneBuffers(scene,renderer,camera,width,height){
  return providers.get(scene)?.render(renderer,camera,width,height)||null;
}

function encodedViewNormal(shader,standard) {
  if(standard)return 'vec4(normalize(normal)*.5+.5,1.0)';
  shader.vertexShader='varying vec3 eveBufferPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
    '#include <project_vertex>\neveBufferPosition=mvPosition.xyz;');
  shader.fragmentShader='varying vec3 eveBufferPosition;\n'+shader.fragmentShader;
  return 'vec4(normalize(cross(dFdx(eveBufferPosition),dFdy(eveBufferPosition)))*.5+.5,1.0)';
}

// Keep native cutout, skinning and instancing in both normal passes.
export function normalBufferShader(shader,standard) {
  const normal=encodedViewNormal(shader,standard);
  shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',
    `gl_FragColor=${normal};return;`);
}

export function bufferShader(shader,standard,emits=true){
  shader.fragmentShader='layout(location=1) out highp vec4 eveSceneNormal;\n'+shader.fragmentShader;
  const normal=encodedViewNormal(shader,standard);
  shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',
    `gl_FragColor=vec4(${standard&&emits?'totalEmissiveRadiance':'vec3(0.0)'},1.0);
     eveSceneNormal=${normal};`);
}

export function createSceneBuffers(scene,{active=()=>true}={}){
  const target=new WebGLRenderTarget(1,1,{count:2,type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter});
  target.depthTexture=new DepthTexture(1,1);
  target.textures[0].name='EVE opaque emission';target.textures[1].name='EVE opaque normals';
  const hiddenMaterial=new MeshBasicMaterial({visible:false}),materials=new Map();
  const view=new Matrix4(),projection=new Matrix4(),viewport=new Vector4(),scissor=new Vector4(),color=new Color();
  let frame=-1,lastCamera,rendering=false,disposed=false,supported;
  const stats={draws:0,fallback:null,fixedReuses:0,partialDraws:0,visibilityRevision:0};
  const architecture=architectureBufferSignature();
  let valid=false,lastLayers,lastDamage;
  const output={target,emission:target.textures[0],normal:target.textures[1],depth:target.depthTexture};
  function replacement(source){
    const key=source.customProgramCacheKey(),cached=materials.get(source);
    if(cached&&cached.key===key&&cached.version===source.version){
      cached.material.opacity=source.opacity;
      if(source.emissive)cached.material.emissive.copy(source.emissive);
      cached.material.emissiveIntensity=source.emissiveIntensity;
      return cached.material;
    }
    cached?.release();
    const material=source.clone(),compile=source.onBeforeCompile;
    material.colorWrite=true;material.toneMapped=false;material.fog=false;
    material.onBeforeCompile=(shader,renderer)=>{compile.call(material,shader,renderer);bufferShader(shader,source.isMeshStandardMaterial,source.colorWrite);};
    material.customProgramCacheKey=()=>key+':eve-scene-buffers-v1';
    const release=()=>{source.removeEventListener('dispose',release);materials.delete(source);material.dispose();};
    source.addEventListener('dispose',release);
    materials.set(source,{material,key,version:source.version,release});return material;
  }
  const writesDepth=m=>m.visible&&m.depthWrite&&m.depthTest;
  function reset(){valid=false;architecture.reset();frame=-1;lastCamera=null;for(const {release} of [...materials.values()])release();target.setSize(1,1);target.dispose();}
  return {
    stats,reset,
    outsideDamage(object){return !lastDamage || architecture.outside(object,lastDamage);},
    stableFor(camera,destination){
      return valid && frame===scene.renderCount && lastCamera===camera &&
        target.width===destination.width && target.height===destination.height;
    },
    render(renderer,camera,width,height){
      if(disposed||rendering||!active())return null;
      supported??=renderer.capabilities.isWebGL2&&renderer.extensions.has('EXT_color_buffer_float');
      if(!supported){stats.fallback='render-target-support';return null;}
      const same=frame===scene.renderCount&&lastCamera===camera&&target.width===width&&target.height===height&&
        view.equals(camera.matrixWorldInverse)&&projection.equals(camera.projectionMatrix);
      if(same)return output;
      const sameView=lastCamera===camera&&lastLayers===camera.layers.mask&&target.width===width&&target.height===height&&
        view.equals(camera.matrixWorldInverse)&&projection.equals(camera.projectionMatrix);
      architecture.begin(camera,width,height,sameView);
      const objects=[];let compatible=true;
      scene.traverseVisible(object=>{
        if(!object.material||!(object.isMesh||object.isLine||object.isPoints||object.isSprite))return;
        const list=Array.isArray(object.material)?object.material:[object.material];
        for(const m of list)if(writesDepth(m)&&(!object.isMesh||m.transparent||!(m.isMeshStandardMaterial||m.isMeshBasicMaterial))){compatible=false;stats.fallback=object.name+':'+m.type;}
        for(const m of list)if(writesDepth(m))architecture.visit(object,m);
        objects.push(object);
      });
      // Unknown depth-writing shaders retain the existing independent passes.
      const stable=architecture.unchanged();
      if(!compatible){valid=false;return null;}
      lastDamage=architecture.damage();
      const partial=valid&&stable&&sameView&&lastDamage;
      if(valid&&stable&&sameView&&!lastDamage){frame=scene.renderCount;stats.fixedReuses++;return output;}
      if(!partial)stats.visibilityRevision++;
      valid=false;
      stats.fallback=null;
      target.setSize(width,height);
      const previous=renderer.getRenderTarget(),background=scene.background,override=scene.overrideMaterial,hook=scene.onBeforeRender;
      const clear=renderer.autoClear,tone=renderer.toneMapping,alpha=renderer.getClearAlpha(),test=renderer.getScissorTest();
      renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(color);
      const swaps=[],hiddenLeaves=[],passMaterials=new Map();
      const replace=source=>{
        if(!writesDepth(source))return hiddenMaterial;
        if(!passMaterials.has(source))passMaterials.set(source,replacement(source));
        return passMaterials.get(source);
      };
      rendering=true;
      try{
        for(const object of objects){
          const original=object.material;
          if(!object.children.length && ((!Array.isArray(original) && !writesDepth(original)) || (partial && architecture.outside(object,partial)))){
            object.visible=false;hiddenLeaves.push(object);continue;
          }
          swaps.push([object,original]);
          object.material=Array.isArray(original)?original.map(replace):replace(original);
        }
        scene.background=null;scene.overrideMaterial=null;scene.onBeforeRender=()=>{};
        renderer.autoClear=true;renderer.toneMapping=NoToneMapping;renderer.setClearColor(0,0);
        renderer.setRenderTarget(target);if(partial){
          // The full viewport keeps clip-space, sample positions and authored ordering identical.
          const dpr=renderer.getPixelRatio();
          renderer.setScissor(partial.x/dpr,partial.y/dpr,(partial.z-partial.x)/dpr,(partial.w-partial.y)/dpr);
          renderer.setScissorTest(true);stats.partialDraws++;
        }else renderer.setScissorTest(false);
        renderPreparedScene(renderer,scene,camera);stats.draws++;valid=stable;lastLayers=camera.layers.mask;
        frame=scene.renderCount;lastCamera=camera;view.copy(camera.matrixWorldInverse);projection.copy(camera.projectionMatrix);
        return output;
      }finally{
        for(const object of hiddenLeaves)object.visible=true;
        for(const [object,material] of swaps)object.material=material;
        scene.background=background;scene.overrideMaterial=override;scene.onBeforeRender=hook;
        renderer.autoClear=clear;renderer.toneMapping=tone;renderer.setClearColor(color,alpha);
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.setRenderTarget(previous);rendering=false;
      }
    },
    dispose(){if(disposed)return;disposed=true;reset();hiddenMaterial.dispose();},
  };
}
