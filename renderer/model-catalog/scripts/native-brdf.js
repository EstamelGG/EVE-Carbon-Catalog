// Compatibility entry used by hull and decal lighting. Formulas live in
// public-direct-brdf.js and environment-brdf-fit.js. The direct integration
// adapter uses an explicitly documented reference-normal hemisphere rule.
import {replaceFunctionBody} from './shader-patching.js';
import {directBRDF} from './native-brdf-response.js';
import {directBRDFDeclarations} from './public-direct-brdf.js';
import {surfaceReflectionDeclarations} from './surface-reflection.js';
import {environmentBRDFDeclarations, indirectBRDF} from './environment-brdf-fit.js';
export {replaceFunctionBody} from './shader-patching.js';

export function nativeLightingChunk(source) {
  source = replaceFunctionBody(source, 'RE_Direct_Physical', directBRDF);
  return surfaceReflectionDeclarations + directBRDFDeclarations + environmentBRDFDeclarations + replaceFunctionBody(source, 'RE_IndirectSpecular_Physical', indirectBRDF);
}
