export const volumeSphereVertex=`out vec3 localPoint,localEye,eyePoint;
void main(){
 mat4 localToView=modelViewMatrix;
 #ifdef USE_INSTANCING
 localToView=localToView*instanceMatrix;
 #endif
 localPoint=position;localEye=(inverse(localToView)*vec4(0,0,0,1)).xyz;
 vec4 p=localToView*vec4(position,1);eyePoint=p.xyz;gl_Position=projectionMatrix*p;}`;
// Public sphere-ray hit distances, including an eye inside the proxy sphere.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/Intersections.fxh#L104-L134
// The depth texture stores perspective depth in [0,1]. Three's view Z is negative.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/packing.glsl.js
const sphereDepth = `
#include <packing>
in vec3 localPoint,localEye,eyePoint;
uniform sampler2D effectSceneDepth;
uniform vec2 effectDepthSize,effectCameraRange;
uniform bool effectHasDepth;
bool sphereSegment(out vec2 interval,out float halfChord,out float radial){
 vec3 delta=localPoint-localEye;
 float distanceToProxy=length(delta);
 if(distanceToProxy==0.0)return false;
 vec3 ray=delta/distanceToProxy;
 float centerDistance=dot(-localEye,ray);
 radial=length(localEye+centerDistance*ray);
 if(radial>.5)return false;
 halfChord=sqrt(max(0.0,.25-radial*radial));
 float entry=max(0.0,centerDistance-halfChord),exitAt=centerDistance+halfChord;
 float stopAt=exitAt;
 if(effectHasDepth){
   float z=texture(effectSceneDepth,gl_FragCoord.xy/effectDepthSize).r;
   float viewZ=perspectiveDepthToViewZ(z,effectCameraRange.x,effectCameraRange.y);
   stopAt=min(exitAt,viewZ/eyePoint.z*distanceToProxy);
 }
 interval=vec2(entry,stopAt)-centerDistance;
 return stopAt>entry;
}`;

// Web volume model: Beer transmittance through the visible chord. The radial
// profile controls extinction, and brightness scales the emitted radiance.
// The CCP header documents spherical haze falloff, source size and brightness.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EveHazeSet.fxh#L8-L24
export const volumeSphereFragment=`${sphereDepth}
out vec4 fragColor;
uniform vec4 HazeControl,HazeColor;
void main(){
 vec2 interval;float halfChord,radial;
 if(!sphereSegment(interval,halfChord,radial))discard;
 float edge=max(0.0,4.0*halfChord*halfChord);
 float profile=HazeControl.x>0.0 ? pow(edge,HazeControl.x) : 1.0;
 float opticalDepth=max(HazeControl.y,0.0)*profile*(interval.y-interval.x);
 fragColor=vec4((1.0-exp(-opticalDepth))*HazeColor.rgb*HazeControl.z,0);
}`;

export const hazeSphereFragment=`${sphereDepth}
out vec4 fragColor;
uniform vec4 HazeControl,HazeColor;
void main(){
 vec2 interval;float halfChord,radial;
 if(!sphereSegment(interval,halfChord,radial))discard;
 // Unit-diameter sphere. Apply the artist's radial falloff to the full chord,
 // then attenuate by the fraction visible in front of the opaque scene.
 float chord=2.0*halfChord;
 float density=pow(chord,max(HazeControl.x,0.0))*(interval.y-interval.x)/chord;
 // The central source occupies a concentric sphere of the specified diameter.
 float coreRadius=0.5*clamp(HazeControl.y,0.0,1.0);
 if(radial<coreRadius){
   float coreHalf=sqrt(coreRadius*coreRadius-radial*radial);
   float coreVisible=max(0.0,min(interval.y,coreHalf)-max(interval.x,-coreHalf));
   density+=HazeControl.z*coreVisible/(2.0*coreRadius);
 }
 fragColor=clamp(min(density,1.0)*HazeColor,0.0,1.0);
}`;
