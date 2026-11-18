const marker = 'eveFilteredOcclusion';
const centerSample = 'float aoLinear=texture2D(aoBuffer,uv).r;';
const mainImage = 'void mainImage';

// SSAO itself is a stochastic spiral with a fixed sample count. At contact
// edges this leaves per-pixel noise that depth-aware upsampling cannot remove.
// Filter the AO buffer at output resolution with a wide bilateral kernel,
// rejecting neighbours across normal or depth discontinuities so silhouettes
// and thin supports stay sharp. Reuse the effect's packed normal/depth texture
// instead of creating a second full-resolution target.
const filter = `uniform sampler2D eveOcclusionGeometry;
float eveOcclusionLinearDepth(float depth){
 return (cameraNear*cameraFar)/((cameraFar-cameraNear)*depth-cameraFar);
}
float eveOcclusionViewDepth(vec2 uv){
 return -eveOcclusionLinearDepth(texture2D(eveOcclusionGeometry,uv).a);
}
vec3 eveOcclusionNormal(vec2 uv){
 return normalize(texture2D(eveOcclusionGeometry,uv).rgb*2.0-1.0);
}
float eveFilteredOcclusion(vec2 uv){
 float centerDepth=eveOcclusionViewDepth(uv);
 vec3 centerNormal=eveOcclusionNormal(uv);
  float centerAo=texture2D(aoBuffer,uv).r;
  // A planar neighbour is not expected to have the same view depth. Predict
  // its depth from the local plane derived from the centre pixel. A raw depth
  // delta incorrectly rejects valid samples on surfaces seen at grazing angles
  // and leaves the SSAO noise untouched.
  float depthDx=dFdx(centerDepth);
  float depthDy=dFdy(centerDepth);
  float depthTolerance=max(0.012,centerDepth*0.004);
  float sum=centerAo,total=1.0;
  for(int y=-4;y<=4;++y){
   for(int x=-4;x<=4;++x){
    if(x==0&&y==0)continue;
    vec2 sampleUv=uv+vec2(float(x),float(y))*texelSize;
    float geometryDepth=texture2D(eveOcclusionGeometry,sampleUv).a;
    if(geometryDepth>=0.99999)continue;
    float sampleDepth=eveOcclusionViewDepth(sampleUv);
    vec3 sampleNormal=eveOcclusionNormal(sampleUv);
    float expectedDepth=centerDepth+depthDx*float(x)+depthDy*float(y);
    float planeDistance=abs(sampleDepth-expectedDepth);
    float depthWeight=1.0-smoothstep(depthTolerance,depthTolerance*4.0,planeDistance);
    float normalWeight=smoothstep(0.72,0.98,dot(centerNormal,sampleNormal));
    float spatialWeight=exp(-float(x*x+y*y)*(1.0/18.0));
    float weight=depthWeight*normalWeight*spatialWeight;
    sum+=texture2D(aoBuffer,sampleUv).r*weight;
    total+=weight;
   }
  }
  return total>0.0?sum/total:centerAo;
}
`;

export function occlusionDenoiseShader(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(centerSample) || !source.includes(mainImage)) return source;
  return source
    .replace(centerSample, 'float aoLinear=eveFilteredOcclusion(uv);')
    .replace(mainImage, `${filter}\n${mainImage}`);
}

export function configureOcclusionDenoise(effect) {
  const geometry = effect.uniforms?.get?.('normalDepthBuffer');
  if (!geometry) return;
  if (!effect.uniforms.has('eveOcclusionGeometry'))
    effect.uniforms.set('eveOcclusionGeometry', geometry);
  effect.setFragmentShader(occlusionDenoiseShader(effect.getFragmentShader()));
}
