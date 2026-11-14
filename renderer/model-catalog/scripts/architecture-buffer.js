import {createScreenBounds} from './screen-bounds.js';
import {Box3, Frustum, Matrix4, Vector4} from 'three';

import {skinnedPoseBounds} from './skinned-pose-bounds.js';

export function architectureBufferSignature() {
  const records = [], bounds = new Box3(), frustum = new Frustum();
  const clip = new Matrix4(),screen=createScreenBounds(),rect=new Vector4();
  const projected=new WeakMap();
  let projectionRevision=0;
  const region=new Vector4(),previous=new Vector4(),damage=new Vector4();
  const empty=r=>r.x>=r.z||r.y>=r.w;
  const extend=(a,b)=>{if(!empty(b))a.set(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.z,b.z),Math.max(a.w,b.w));};
  let cursor=0, dirty=true;
  return {
    begin(camera,width,height,sameView) {
      if(!sameView)projectionRevision++;
      region.set(width,height,0,0);screen.begin(camera,width,height);
      cursor=0;dirty=false;
      clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(clip,camera.coordinateSystem,camera.reversedDepth);
    },
    visit(object, material) {
      const inputs=material.eveFixedBufferInputs;
      if (!inputs || Array.isArray(object.material) || object.morphTargetInfluences?.length ||
          object.isInstancedMesh && !object.hangarSourceMatrices) {dirty=true;return;}
      if(object.isSkinnedMesh){
        if(!skinnedPoseBounds(object,bounds)){dirty=true;return;}
        bounds.applyMatrix4(object.matrixWorld);
        if(!frustum.intersectsBox(bounds))return;
        screen.project(bounds,rect);extend(region,rect);
        // Include visible skins in the identity/material checks below.
      } else if(object.frustumCulled && !object.geometry) {
        dirty=true;return;
      }
      let row=records[cursor++];
      if(!row || row.object!==object || row.material!==material){
        row={object,material,matrix:object.matrixWorld.clone()};records[cursor-1]=row;dirty=true;
      }
      if(!row.matrix.equals(object.matrixWorld)){row.matrix.copy(object.matrixWorld);dirty=true;}
      if(row.version!==material.version || row.inputs!==inputs.revision ||
         row.instances!==object.instanceMatrix?.version || row.count!==object.count || row.layers!==object.layers.mask){
        row.version=material.version;row.inputs=inputs.revision;row.instances=object.instanceMatrix?.version;
        row.count=object.count;row.layers=object.layers.mask;dirty=true;
      }
    },
    damage(){
      damage.copy(region);extend(damage,previous);previous.copy(region);
      return empty(damage)?null:damage;
    },
    outside(object,region){
      if(!object.frustumCulled || object.isSkinnedMesh || !object.hangarSourceMatrices)return false;
      let cached=projected.get(object);
      if(!cached || cached.revision!==projectionRevision || !cached.matrix.equals(object.matrixWorld)){
        const box=screen.objectBox(object);
        if(!box)return false;
        if(!cached){cached={rect:new Vector4(),matrix:new Matrix4()};projected.set(object,cached);}
        screen.project(box,cached.rect);cached.matrix.copy(object.matrixWorld);cached.revision=projectionRevision;
      }
      const r=cached.rect;return r.z<region.x || r.w<region.y || r.x>region.z || r.y>region.w;
    },
    unchanged(){
      if(records.length!==cursor){records.length=cursor;return false;}
      return !dirty;
    },
    reset(){records.length=0;},
  };
}
