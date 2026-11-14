import {renderPreparedScene} from './prepared-scene.js';
import {AlwaysDepth,Color,Mesh,MeshBasicMaterial,NoBlending,NoToneMapping,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector4} from 'three';

// Copy both opaque emission and its depth in one fullscreen draw, then draw
// only transparent emission. No shared texture ownership between render targets.
export function createEmissionComposite(scene,target,replacement){
  const geometry=new PlaneGeometry(2,2),copyScene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1);
  const material=new ShaderMaterial({depthTest:true,depthWrite:true,depthFunc:AlwaysDepth,blending:NoBlending,toneMapped:false,
    uniforms:{colorBuffer:{value:null},depthBuffer:{value:null}},
    vertexShader:'varying vec2 copyUV;void main(){copyUV=uv;gl_Position=vec4(position.xy,0,1);}',
    fragmentShader:'uniform sampler2D colorBuffer,depthBuffer;varying vec2 copyUV;void main(){gl_FragColor=texture2D(colorBuffer,copyUV);gl_FragDepth=texture2D(depthBuffer,copyUV).r;}',
  });
  material.name='EVE emission and depth copy';const quad=new Mesh(geometry,material);quad.frustumCulled=false;copyScene.add(quad);
  const viewport=new Vector4(),scissor=new Vector4(),color=new Color();
  const hiddenMaterial=new MeshBasicMaterial({visible:false});
  return {
    render(renderer,view,buffers){
      target.setSize(buffers.target.width,buffers.target.height);
      const previous=renderer.getRenderTarget(),background=scene.background,override=scene.overrideMaterial,hook=scene.onBeforeRender;
      const clear=renderer.autoClear,tone=renderer.toneMapping,alpha=renderer.getClearAlpha(),test=renderer.getScissorTest();
      renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(color);
      const swaps=[],hiddenLeaves=[],passMaterials=new Map();
      const replace=source=>{
        if(source.depthWrite&&source.depthTest)return hiddenMaterial;
        if(!passMaterials.has(source))passMaterials.set(source,replacement(source));
        return passMaterials.get(source);
      };
      try{
        scene.traverseVisible(object=>{
          if(!object.material||!(object.isMesh||object.isLine||object.isPoints||object.isSprite))return;
          const original=object.material;
          if(!object.children.length && original.depthWrite && original.depthTest){
            object.visible=false;hiddenLeaves.push(object);return;
          }
          // Hide material groups, not their objects: an opaque parent can own
          // transparent descendants which still contribute authored emission.
          swaps.push([object,original]);object.material=Array.isArray(original)?original.map(replace):replace(original);
        });
        scene.background=null;scene.overrideMaterial=null;scene.onBeforeRender=()=>{};
        renderer.toneMapping=NoToneMapping;renderer.autoClear=true;renderer.setClearColor(0,0);
        renderer.setRenderTarget(target);renderer.setScissorTest(false);
        material.uniforms.colorBuffer.value=buffers.emission;material.uniforms.depthBuffer.value=buffers.depth;
        renderer.render(copyScene,camera);
        renderer.autoClear=false;renderPreparedScene(renderer,scene,view);return target;
      }finally{
        for(const object of hiddenLeaves)object.visible=true;
        for(const [object,m] of swaps)object.material=m;
        scene.background=background;scene.overrideMaterial=override;scene.onBeforeRender=hook;
        renderer.autoClear=clear;renderer.toneMapping=tone;renderer.setClearColor(color,alpha);
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.setRenderTarget(previous);
      }
    },
    dispose(){geometry.dispose();material.dispose();hiddenMaterial.dispose();},
  };
}
