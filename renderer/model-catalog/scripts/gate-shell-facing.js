/* Preview controls for an oriented emissive shell. Reflectance is a normalized
 * cosine-power lobe; the sign selects the edge or central lobe. Keep black
 * when a controller sets gain to zero, including at exactly grazing incidence. */
export const shellFacing = `
float shellIntensity(float cosine,vec4 control) {
  float incidence=clamp(cosine-control.z,0.0,1.0);
  float angular=control.y<0.0 ? incidence : 1.0-incidence;
  return abs(control.y)*(control.x==0.0 ? 1.0 : pow(angular,max(control.x,0.0)));
}`;
