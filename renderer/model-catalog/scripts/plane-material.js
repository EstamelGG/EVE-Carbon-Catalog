import { planeFade } from './attachment-blink.js';

// Input layout: carbonengine/trinity, EvePlaneSet.fxh (f644516).
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/SpaceScene/EvePlaneSet.fxh
// GetAverageColor multiplies the map channels for the associated light. Here
// we apply that model per sample. Alpha, facing and screen orientation are
// viewer choices measured against first-generation images (review section 35).
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EvePlaneSet.cpp#L499-L527
const inputs = `
flat in vec4 transform1, transform2, scroll1, scroll2, blinkData;
flat in float maskAtlasID;
flat in vec3 lightColor;
uniform float time;
uniform vec4 planeData;
uniform sampler2D layer1Map, layer2Map, maskMap;
in vec2 planeUV;
in vec3 planeNormal, viewPosition;
out vec4 fragColor;

vec2 layerOrigin(vec4 transform, vec4 scroll) {
  return planeUV * transform.xy + (transform.zw + scroll.zw);
}

float angularGain() {
  float cosine = abs(dot(normalize(planeNormal), normalize(viewPosition)));
  return mix(1.0, cosine, planeData.x);
}
`;

export const planeFragment = inputs + planeFade + `
void main() {
  vec2 uv1 = layerOrigin(transform1, scroll1) + time * scroll1.xy;
  vec2 uv2 = layerOrigin(transform2, scroll2) + time * scroll2.xy;
  vec2 grid = max(planeData.zw * planeData.y, vec2(1.0));
  // The CCP WebGL buffer carries signed indices unchanged. Measured negative
  // tiles wrap across columns, advancing a row only after a whole row of IDs.
  // https://github.com/ccpgames/ccpwgl/blob/c31632d0fb7d9f0be19a5eb5452e5d5f74a914c5/src/eve/item/EvePlaneSet.js#L185-L239
  vec2 tile = vec2(mod(maskAtlasID, grid.x), trunc(maskAtlasID / grid.x));
  vec3 mask = texture(maskMap, (tile + planeUV) / grid).rgb;
  vec3 layers = texture(layer1Map, uv1).rgb * texture(layer2Map, uv2).rgb;
  float gain = angularGain() * planeFade(blinkData, time);
  fragColor = vec4(mask * layers * lightColor * gain, 0.0);
}`;

export const hologramFragment = inputs + `
uniform sampler2D imageMap;

// Both faces present the same readable image. Horizontal motion is measured
// in screen UVs after orientation, so the pattern travels the same way on both.
vec2 readableUV(vec2 uv) {
  return vec2(gl_FrontFacing ? uv.x : 1.0 - uv.x, uv.y);
}

vec4 screenLayer(sampler2D layer, vec4 transform, vec4 scroll) {
  vec2 velocity = vec2(-scroll.x, scroll.y);
  return texture(layer, readableUV(layerOrigin(transform, scroll)) + velocity * time);
}

void main() {
  vec2 uv = readableUV(planeUV);
  vec4 layers = screenLayer(layer1Map, transform1, scroll1)
              * screenLayer(layer2Map, transform2, scroll2);
  vec4 image = texture(imageMap, uv) * layers;
  vec3 mask = texture(maskMap, uv).rgb;
  fragColor = vec4(image.rgb * lightColor * mask * (image.a * angularGain()), 0.0);
}`;
