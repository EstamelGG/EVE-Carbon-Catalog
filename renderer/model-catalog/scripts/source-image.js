import {LinearFilter, TextureLoader} from 'three';

// The viewer initializes this shared transcoder for its active WebGL renderer.
// A packed resource may be a blob URL, so dispatch using the original URL.
export async function loadSourceImage(url, progress, original = url) {
  if (/\.dds(?:[?#]|$)/i.test(original)) {
    const {SurfaceDDSLoader} = await import('./surface-dds.js');
    const redOnly = /[?&]channels=r(?:&|$)/.test(original);
    return new SurfaceDDSLoader(undefined, redOnly).loadAsync(url, progress);
  }
  const compressed = /\.ktx2(?:[?#]|$)/i.test(original);
  const loader = compressed
    ? (await import('@google/model-viewer/lib/three-components/CachingGLTFLoader.js')).ktx2Loader
    : new TextureLoader();
  const texture = await loader.loadAsync(url, progress);
  // Match the base-level glTF sampler for standalone surface / effect bindings.
  if (!compressed && /[?&]mip=0(?:[&#]|$)/.test(original)) {
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
  }
  return texture;
}
