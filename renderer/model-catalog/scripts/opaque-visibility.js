/** An actual opaque draw which passes zero depth/stencil samples cannot affect
 * the framebuffer. Reuse that answer only while the entire opaque depth input
 * and the camera are unchanged. Poll available results without waiting on GPU. */
export function createOpaqueVisibility(scene, buffers) {
  const pending = new Map(), answers = new Map(), hidden = new Set();
  let generation, context, activeTarget, activeCamera;
  const temporarilyHidden=[];
  const stats = buffers.stats;
  stats.occludedDraws = 0;
  function clear() {
    for (const query of pending.values()) context.deleteQuery(query);
    pending.clear();
    answers.clear();hidden.clear();
  }
  return {
    hideOccluded(renderer,camera){
      const target=activeTarget;
      if(!target || camera!==activeCamera || renderer.getRenderTarget()!==target ||
          !buffers.stableFor(camera,target) || generation!==stats.visibilityRevision)return;
      for(const object of hidden){
        if(object.visible && buffers.outsideDamage(object)){object.visible=false;temporarilyHidden.push(object);}
      }
      stats.occludedDraws+=temporarilyHidden.length;
    },
    render(renderer, camera, target, draw) {
      if (!target || target.samples || 
          renderer.xr.isPresenting || renderer.getScissorTest()) return draw();
      const gl=renderer.getContext(), direct=renderer.renderBufferDirect;
      if(context!==gl){clear();context=gl;generation=undefined;}
      activeTarget=target;activeCamera=camera;
      let queries=0;
      renderer.renderBufferDirect=function(cam,world,geometry,m,object,group){
        if(cam!==camera || world!==scene || this.getRenderTarget()!==target || !buffers.stableFor(cam,target) ||
           !object.hangarSourceMatrices || m!==object.material || group || m.transparent || !m.depthWrite ||
           !m.depthTest || !m.colorWrite || m.stencilWrite || !m.eveFixedBufferInputs) return direct.apply(this,arguments);
        if(generation!==stats.visibilityRevision){clear();generation=stats.visibilityRevision;}
        if(!buffers.outsideDamage(object)){
          answers.delete(object);hidden.delete(object);
          const query=pending.get(object);if(query){gl.deleteQuery(query);pending.delete(object);}
          return direct.apply(this,arguments);
        }
        if(answers.get(object)===false){stats.occludedDraws++;return;}
        const previous=pending.get(object);
        if(previous && gl.getQueryParameter(previous,gl.QUERY_RESULT_AVAILABLE)){
          const visible=Boolean(gl.getQueryParameter(previous,gl.QUERY_RESULT));
          gl.deleteQuery(previous);pending.delete(object);answers.set(object,visible);
          if(!visible){hidden.add(object);stats.occludedDraws++;return;}
        }
        if(!previous && !answers.has(object) && queries<32){
          const query=gl.createQuery();
          if(query){
            queries++;
            gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE,query);
            try{return direct.apply(this,arguments);}
            finally{gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);pending.set(object,query);}
          }
        }
        return direct.apply(this,arguments);
      };
      try{return draw();}finally{
        renderer.renderBufferDirect=direct;activeTarget=null;activeCamera=null;
        for(const object of temporarilyHidden)object.visible=true;
        temporarilyHidden.length=0;
      }
    },
    clear,
  };
}
