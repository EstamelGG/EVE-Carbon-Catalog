import {DataTexture, FloatType, Matrix4, NearestFilter, RedFormat, RGBAFormat} from 'three';

// Four RGBA texels store three affine rows and the extinction density. View
// space lets the fragment shader use the final stretched billboard position.
export function createParticleFog() {
  const matrix=new Matrix4();
  let data=new Float32Array(16);
  const texture=new DataTexture(data,4,1,RGBAFormat,FloatType);
  texture.magFilter=texture.minFilter=NearestFilter;
  texture.needsUpdate=true;
  // A grid occupies size rows of the byte atlas, one per Z slice. Each slice
  // flattens as X + Y*size. Shared source grids are uploaded once per layout.
  let layouts=[],offsets=new Map();
  const atlas=new DataTexture(new Uint8Array(256),256,1,RedFormat);
  atlas.magFilter=atlas.minFilter=NearestFilter;
  atlas.needsUpdate=true;
  function syncAtlas(volumes){
    const grids=new Map();
    for(const {record} of volumes){
      const grid=record?.grid;
      if(grid&&[8,16].includes(grid.size)&&grid.cells?.length===grid.size**3)
        grids.set(grid.cells,grid.size);
    }
    if(grids.size===layouts.length&&layouts.every(([cells,size])=>grids.get(cells)===size))return;
    layouts=[...grids];offsets=new Map();
    const height=Math.max(1,layouts.reduce((sum,[,size])=>sum+size,0));
    const bytes=new Uint8Array(256*height);
    let row=0;
    for(const [cells,size] of layouts){
      offsets.set(cells,row);
      for(let z=0;z<size;z++){
        const from=z*size*size;
        for(let xy=0;xy<size*size;xy++)bytes[256*row+xy]=cells[from+xy];
        row++;
      }
    }
    atlas.dispose();atlas.image={data:bytes,width:256,height};atlas.needsUpdate=true;
  }
  const uniforms={particleFogGrid:{value:atlas},particleFogMap:{value:texture},particleFogCount:{value:0}};
  function update(scene,camera){
    const volumes=scene.userData.eveParticleFogVolumes||[];
    syncAtlas(volumes);
    let count=0,dirty=false;
    if(volumes.length>data.length/16){
      data=new Float32Array(16*2**Math.ceil(Math.log2(volumes.length)));
      texture.dispose();
      texture.image={data,width:4,height:data.length/16};dirty=true;
    }
    for(const {object,density,record} of volumes){
      const grid=record?.grid,row=offsets.get(grid?.cells);
      const useGrid=row!==undefined&&Number.isFinite(record.gain);
      const gain=useGrid?record.gain:density;
      if(!object||!Number.isFinite(gain)||gain<=0)continue;
      let node=object;
      while(node&&node.visible&&node!==scene)node=node.parent;
      if(node!==scene||!scene.visible)continue;
      object.updateWorldMatrix(true,false);
      if(!object.matrixWorld.determinant())continue;
      matrix.copy(object.matrixWorld).invert().multiply(camera.matrixWorld);
      const e=matrix.elements,offset=16*count++;
      for(let col=0;col<4;col++)for(let row=0;row<3;row++){
        const i=offset+4*row+col,v=Math.fround(e[col*4+row]);
        if(data[i]!==v){data[i]=v;dirty=true;}
      }
      const v=Math.fround(gain);
      const n=useGrid?grid.size:0,first=useGrid?row:0;
      if(data[offset+12]!==v||data[offset+13]!==n||data[offset+14]!==first){
        data[offset+12]=v;data[offset+13]=n;data[offset+14]=first;dirty=true;
      }
    }
    uniforms.particleFogCount.value=count;
    if(dirty)texture.needsUpdate=true;
  }
  return {uniforms,update,dispose(){texture.dispose();atlas.dispose();}};
}

export const particleFogFragment=`
in vec3 fogViewPosition;
uniform sampler2D particleFogMap;
uniform int particleFogCount;
uniform sampler2D particleFogGrid;

// Integrate piecewise-constant voxel density exactly along the clipped ray.
// At most 3*size voxel boundaries can be crossed within a cube.
float fogGridDepth(vec3 origin,vec3 delta,float entry,float end,int n,int row){
  vec3 uv=(origin+delta*entry+.5)*float(n),velocity=delta*float(n);
  ivec3 cell=clamp(ivec3(floor(uv)),ivec3(0),ivec3(n-1));
  ivec3 stepDir=ivec3(sign(delta));
  vec3 nextEdge=vec3(1e30),stride=vec3(1e30);
  for(int axis=0;axis<3;axis++)if(abs(delta[axis])>=1e-12){
    float boundary=float(cell[axis])+float(stepDir[axis]>0);
    nextEdge[axis]=entry+(boundary-uv[axis])/velocity[axis];
    stride[axis]=1./abs(velocity[axis]);
  }
  float t=entry,total=0.;
  for(int k=0;k<49;k++){
    float finish=min(end,min(nextEdge.x,min(nextEdge.y,nextEdge.z)));
    float value=texelFetch(particleFogGrid,ivec2(cell.x+n*cell.y,row+cell.z),0).r;
    total+=max(0.,finish-t)*value;
    if(finish>=end)break;
    for(int axis=0;axis<3;axis++)if(nextEdge[axis]<=finish){
      cell[axis]+=stepDir[axis];nextEdge[axis]+=stride[axis];
    }
    if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,ivec3(n))))break;
    t=max(t,finish);
  }
  return total;
}
float particleTransmission(){
  vec3 start=isOrthographic?vec3(fogViewPosition.xy,0.):vec3(0.);
  vec3 ray=fogViewPosition-start;
  float tau=0.;
  for(int i=0;i<particleFogCount;i++){
    vec3 origin,delta;
    for(int j=0;j<3;j++){
      vec4 row=texelFetch(particleFogMap,ivec2(j,i),0);
      origin[j]=dot(row,vec4(start,1.));
      delta[j]=dot(row.xyz,ray);
    }
    float entry=0.,exitAt=1.;
    for(int axis=0;axis<3;axis++){
      float d=delta[axis],p=origin[axis];
      if(abs(d)<1e-12){if(abs(p)>.5)exitAt=-1.;}
      else{
        float a=(-.5-p)/d,b=(.5-p)/d;
        entry=max(entry,min(a,b));exitAt=min(exitAt,max(a,b));
      }
    }
    if(exitAt<=entry)continue;
    vec3 info=texelFetch(particleFogMap,ivec2(3,i),0).xyz;
    float column=info.y>0.?fogGridDepth(origin,delta,entry,exitAt,int(info.y),int(info.z)):exitAt-entry;
    tau+=column*length(delta)*info.x;
  }
  return exp(-tau);
}`;
