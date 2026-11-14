// Application transport contract, not an inherited attenuation algorithm.
// Builders publish raw radius / innerRadius, in source length units. Both
// scale once into render units; brightness/color remain authored values.
// Official field scaling: LightData::AsPerPointLightData / AsPerSpotLightData:
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Lights/Tr2Light.cpp
// Three r183 WebGLLights.setup copies distance/decay into its light uniforms:
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/webgl/WebGLLights.js
// Our custom light shader uses the decay slot to TRANSPORT innerRadius; it
// never treats it as an exponent. All consumers must use sourceLightPars().
// effect-performance.js copies both slots when assigning pooled lights.
export function setSourceLightRadii(light, radius, innerRadius, scale=1) {
  light.distance=Math.max(0,radius||0)*scale;
  light.decay=Math.max(0,innerRadius||0)*scale;
}
