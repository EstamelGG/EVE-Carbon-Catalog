// Resource-loading adapter. Public mip math and the independently implemented
// preview response are separate from texture IO; see remediation segment 06.
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { resourceURL } from '../src/resource-location.mjs';
import { loadJSON, trackResource, readResourceBody } from '../src/resource-activity.mjs';
import {parseNativeHDR} from './hdr-cube.js';
import { SRGBColorSpace, Vector3, Matrix3, Matrix4, Quaternion } from 'three';

export {roughnessMip} from './carbon-environment-map.js';
export {reflectionDeclarations} from './preview-reflection-shader.js';

// Share pending reflection loads between prefetch and material installation.
export function sessionReflections(session, race) {
  const cache = session.reflections;
  if (!cache.has(race)) cache.set(race,
    loadReflections(session.resources, race, session.json).catch(error => { cache.delete(race); throw error; }));
  return cache.get(race);
}
export async function loadReflections(resources, race, json = url => loadJSON(resourceURL(url))) {
  // reflection-preview v3 is emitted by reflection_assets.py without a client
  // worker: raw BLACK fields + official EveSpaceScene constructor defaults.
  // v2/v3 share rendering fields; v3 only adds construction provenance. This
  // does not establish the provenance of upstream material/roughness composition.
  const settings=await json('data/reflection-preview.json'), source=settings.races[race] || settings.races.gallente;
  return loadReflectionSource(resources, settings, source);
}

function hdrPath(url) {
  return /\.hdr\.dds$/i.test(String(url).split(/[?#]/, 1)[0]);
}

export async function loadReflectionSource(resources, settings, source) {
  const load=async url=>{
    const legacyHDR = hdrPath(url);
    url=(resources.resolveURL || resourceURL)(url);
    const sourceURL=resources.binaryURL?.(url)||url;
    return trackResource(url, async progress => {
      if (legacyHDR || hdrPath(url)) {
        const response = await fetch(sourceURL);
        if (!response.ok) throw new Error('Missing HDR cube');
        return resources.own(parseNativeHDR(await readResourceBody(response, progress)));
      }
      const texture=resources.own(await new DDSLoader().loadAsync(sourceURL, event => progress(event.loaded, event.lengthComputable ? event.total : 0)));
      texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;
      return texture;
    }, 'resourceTexture');
  };
  const [reflection,diffuse]=await Promise.all([load(source.reflection),load(source.diffuse)]);
  return {settings,source,uniforms:{
    eve_environmentStrength:{value:source.intensity},
    eve_reflectionCube:{value:reflection},eve_diffuseCube:{value:diffuse},
    eve_reflectionMips:{value:reflection.image[0].mipmaps.length},
    eve_diffuseFromReflection:{value:Number.isFinite(source.defaultDiffuseRoughness)},
    eve_diffuseRoughness:{value:source.defaultDiffuseRoughness??1},
    eve_backlight:{value:new Vector3(...source.backlight)},eve_backlightContrast:{value:source.contrast},
    eve_cubeRotation:{value:new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion(...source.rotation).normalize().invert()))},
  }};
}
