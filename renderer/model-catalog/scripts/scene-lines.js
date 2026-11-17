// SOURCE AUDIT 2026-11-11 [E07]: Official circle point construction corroborated; phase, limits and line shading are local adaptations.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// Reference: https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/LineSetPaths/EveCircle.cpp
// EveCircle point placement follows Trinity EveCircle::GeneratePoints.
import {Matrix4,Vector3,Vector4,QuadraticBezierCurve3,CustomBlending,OneFactor,OneMinusSrcAlphaFactor} from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {authoredLocal} from './ship-authored-spotlights.js';

const finitePoint = value =>
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);

export function circlePoints(path,time=0) {
  if(!Number.isFinite(path.circleRadius))return [];
  time=Number.isFinite(time)?time:0;
  const completeness=Math.max(0,Math.min(2,path.completeness??1));
  const fraction=1-Math.abs(completeness-1),n=Math.floor(((path.numSegments||64)+.5)*(path.scaleSegmentsByCompleteness?fraction:1));
  if(n<=1)return [];
  const arc=fraction*Math.PI*2,start=(path.startPoint||0)*Math.PI*2+Math.max(completeness-1,0)*Math.PI*2+arc/(2*n);
  const phase=path.movementSpeed ? ((path.animValue||0)+path.movementSpeed*time)%1 : path.animValue||0;
  const r=path.circleRadius,d=path.circleDistort||[1,0,1,0];
  const transform=authoredLocal(path),points=[];
  for(let i=0;i<n;i++){
    const angle=start+arc*(i/n+phase/n),s=Math.sin(angle),c=Math.cos(angle);
    const y=d[1]||d[3]?r*(s*s*(s<0?d[0]:d[2])+c*c*(c<0?d[3]:d[1])):0;
    points.push(new Vector3(c*r,y,s*r).applyMatrix4(transform));
  }
  const result=[],segments=fraction===1?n:n-1;
  for(let i=0;i<segments;i++)result.push(...points[i].toArray(),...points[(i+1)%n].toArray());
  return result;
}

export async function sceneLines(record,resources,root) {
  const [tex,overlay]=await Promise.all([resources.texture(record.textures.TexMap),resources.texture(record.textures.OverlayTexMap,{repeat:true})]);
  const entries=[];
  const paths=[];
  const baseColor=Array.isArray(record.baseColor)&&record.baseColor.length>=4?record.baseColor:[0,0,0,0];
  const animColor=Array.isArray(record.animColor)&&record.animColor.length>=4?record.animColor:[0,0,0,0];
  function flatten(sources,parents=[]){for(const source of sources){
    if(source.type==='trinity.EveLineChildContainer')flatten(source.lines||[],[...parents,source]);
    else paths.push({source,parents});}}
  flatten(record.paths);
  for(const {source,parents} of paths){
    const geometry=resources.own(new LineSegmentsGeometry());
    const material=resources.own(new LineMaterial({color:0xffffff,linewidth:source.lineWidth||1,transparent:true,depthWrite:false,blending:CustomBlending,blendSrc:OneFactor,blendDst:OneFactor,blendSrcAlpha:OneFactor,blendDstAlpha:OneMinusSrcAlphaFactor}));
    const extra={eveLineMap:{value:tex},eveLineOverlay:{value:overlay},eveLineTint:{value:new Vector4()},eveLineAnim:{value:new Vector4()},eveLineTime:{value:0}};
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,extra);
      shader.fragmentShader='uniform sampler2D eveLineMap,eveLineOverlay;uniform vec4 eveLineTint,eveLineAnim;uniform float eveLineTime;\n'+shader.fragmentShader;
      // Three writes alpha separately after clipping its wide-line end caps.
      // Apply each independent emission mask before the additive blend.
      shader.fragmentShader=shader.fragmentShader.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );',`
        vec2 lineUV=clamp(vUv*0.5+0.5,0.0,1.0);
        vec4 base=texture2D(eveLineMap,vec2(lineUV.x,0.5))*eveLineTint;
        vec4 overlay=texture2D(eveLineOverlay,vec2(lineUV.x,lineUV.y+eveLineTime))*eveLineAnim;
        vec3 emitted=base.rgb*clamp(base.a,0.0,1.0)+overlay.rgb*clamp(overlay.a,0.0,1.0);
        float coverage=1.0-(1.0-clamp(base.a,0.0,1.0))*(1.0-clamp(overlay.a,0.0,1.0));
        gl_FragColor=vec4(emitted*alpha,coverage*alpha);`);
    };
    material.customProgramCacheKey=()=> 'eve-emissive-lines-v2';
    const mesh=new LineSegments2(geometry,material);mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;root.add(mesh);
    entries.push({source,parents,geometry,material,mesh,extra,last:null});
  }
  const base=new Matrix4(),lastRoot=new Matrix4(),lastWorld=new Matrix4(),local=new Matrix4();
  let initialized=false;
  return {update(animation,world,visible,time,width,height){
    const moved=!initialized || !lastRoot.equals(root.matrixWorld) || !lastWorld.equals(world);
    if(moved){
      initialized=true;lastRoot.copy(root.matrixWorld);lastWorld.copy(world);
      base.copy(root.matrixWorld).invert().multiply(world);
    }
    const node=animation.node(record.transforms.at(-1)),brightness=node.brightness??record.brightness;
    for(const e of entries){
      const path=animation.node(e.source),movingCircle=path.type==='trinity.EveCircle'&&path.movementSpeed;
      const staticPath=animation.animatedFields && !animation.animatedFields.has(e.source.fxID) && !movingCircle;
      const signature=staticPath ? path : JSON.stringify(path)+(movingCircle?time:'');
      if(signature!==e.last){const points=linePoints(path,time,e);e.geometry.setPositions(points.length?points:[0,0,0,0,0,0]);e.last=signature;e.hasPoints=points.length>0;}
      e.mesh.visible=visible&&path.display!==false&&brightness>0&&e.hasPoints&&e.parents.every(p=>animation.node(p).display!==false);
      e.fixedParents??=Boolean(animation.animatedFields && e.parents.every(parent=>!animation.animatedFields.has(parent.fxID)));
      if(moved || !e.fixedParents){
        e.mesh.matrix.copy(base);
        for(const parent of e.parents)e.mesh.matrix.multiply(authoredLocal(animation.node(parent),local));
        e.mesh.updateMatrixWorld(true);
      }
      e.material.resolution.set(width,height);
      e.extra.eveLineTint.value.fromArray(baseColor).multiplyScalar(brightness);
      e.extra.eveLineAnim.value.fromArray(animColor).multiplyScalar(brightness);
      e.extra.eveLineTime.value=Number.isFinite(time)&&Number.isFinite(record.scrollSpeed)
        ?(time*record.scrollSpeed)%1:0;
    }
  },dispose(){for(const e of entries)e.mesh.removeFromParent();}};
}

// EveBezierCurve::GeneratePoints and ::AddLinesToSet use distinct endpoint rules.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/LineSetPaths/EveBezierCurve.cpp#L92-L126
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/LineSetPaths/EveBezierCurve.cpp#L166-L204
export function linePoints(path, time=0, state) {
  if (path.type !== 'trinity.EveBezierCurve') return circlePoints(path, time);
  if (!finitePoint(path.point1) || !finitePoint(path.bezierPoint) || !finitePoint(path.point2)) return [];
  time = Number.isFinite(time) ? time : 0;
  const completeness = Math.min(2, Math.max(0, path.completeness ?? 1));
  const span = 1 - Math.abs(completeness - 1);
  const start = Math.max(0, completeness - 1);
  const segments = Math.min(128, Math.max(1, path.segments ?? 24));
  const count = Math.floor((segments + 0.5) * (path.scaleSegmentsByCompleteness === false ? 1 : span));
  if (count < 2) {
    // GeneratePoints retains the previous local points. With one requested
    // point AddLinesToSet can still join the cached first point to point2.
    if (count !== 1 || completeness < 1 || !state?.firstBezierPoint) return [];
    const transform = authoredLocal(path);
    return [...state.firstBezierPoint.clone().applyMatrix4(transform).toArray(),
      ...new Vector3().fromArray(path.point2).applyMatrix4(transform).toArray()];
  }
  const curve = new QuadraticBezierCurve3(new Vector3().fromArray(path.point1),
    new Vector3().fromArray(path.bezierPoint), new Vector3().fromArray(path.point2));
  const transform = authoredLocal(path);
  const offset = Math.min(1, Math.max(0, path.segmentOffset ?? 0));
  let previous = curve.getPoint(start + span * offset / count);
  if (state) state.firstBezierPoint = previous.clone();
  previous.applyMatrix4(transform);
  const result = [];
  for (let i = 1; i < count; i++) {
    const next = curve.getPoint(start + span * (i + offset) / count).applyMatrix4(transform);
    result.push(...previous.toArray(), ...next.toArray());
    previous = next;
  }
  if (completeness >= 1) result.push(...previous.toArray(), ...curve.v2.clone().applyMatrix4(transform).toArray());
  return result;
}
