import { NoColorSpace } from 'three';
import {loadSourceImage} from './source-image.js';
import {trackResource} from '../src/resource-activity.mjs';

// Reuse GLTFLoader's decoded images, including ImageBitmaps. Each consumer owns
// a texture clone so changing UVs/color space or disposing it cannot affect the
// cached glTF. New URLs also share a single pending decode across consumers.
export function createModelTextureLoader(
  model,
  document,
  modelUrl,
  own,
  load = (url) => trackResource(url,progress=>loadSourceImage(url,
    event=>progress(event.loaded,event.lengthComputable?event.total:0)),'resourceTexture'),
) {
  const sources = new Map();
  const absolute = (url) => new URL(url, modelUrl).href;
  model.traverse((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      for (const texture of Object.values(material || {})) {
        if (!texture?.isTexture) continue;
        const index = texture.userData?.associations?.textures;
        const definition = document.textures?.[index];
        const source = definition?.extensions?.MSFT_texture_dds?.source ?? definition?.extensions?.KHR_texture_basisu?.source ?? definition?.extensions?.EXT_texture_webp?.source ?? definition?.source;
        const uri = document.images?.[source]?.uri;
        if (uri) sources.set(absolute(uri), Promise.resolve(texture));
      }
    }
  });
  return async (url) => {
    const href = absolute(url);
    if (!sources.has(href)) sources.set(href, load(href).then(own).catch(error => { sources.delete(href); throw error; }));
    const texture = (await sources.get(href)).clone();
    // A glTF slot may have KHR_texture_transform or a different UV/color role.
    // Consumers configure their own interpretation, as with a fresh loader.
    texture.colorSpace = NoColorSpace;
    texture.channel = 0;
    texture.offset.set(0, 0);
    texture.repeat.set(1, 1);
    texture.center.set(0, 0);
    texture.rotation = 0;
    texture.matrixAutoUpdate = true;
    texture.updateMatrix();
    return texture;
  };
}
