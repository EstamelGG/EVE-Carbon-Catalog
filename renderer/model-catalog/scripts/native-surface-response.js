import policy from '../../shared/material-policy.json' with {type:'json'};

// A quadratic Bézier gain on the squared mask keeps black, white and monotonicity.
// Its controls were fitted to first-generation WebGL grayscale readbacks in segment 78.
export function glowResponseGLSL(glass) {
  const [low, middle] = policy.glowResponse[glass ? 'glass' : 'hull'].map(value => value.toFixed(6));
  return `float eveGlowResponse(float mask) {
    float x=clamp(mask,0.0,1.0);
    return x*x*mix(mix(${low},${middle},x),mix(${middle},1.0,x),x);
  }
`;
}

export const roughnessExpression = 'float roughnessFactor=eveAlpha;';
export const glowMaskExpression = 'eveGlowResponse(texture2D(eve_GlowMap,eveUV).r)*eve_useGlowMap';
export const emissionExpression = `totalEmissiveRadiance=${glowMaskExpression}*eve_glowColor;`;
