import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { $renderer } from '@google/model-viewer/lib/model-viewer-base.js';
import { CachingGLTFLoader, $evictionPolicy, $loader } from '@google/model-viewer/lib/three-components/CachingGLTFLoader.js';
import { ModelViewerGLTFInstance } from '@google/model-viewer/lib/three-components/gltf-instance/ModelViewerGLTFInstance.js';
import {surfaceDDSPlugin} from './surface-dds.js';
import { gltfDimensions } from './model-bounds.js';
import { parseSharedHull } from './shared-hull.js';
import { resourceActivity, loadArrayBuffer, trackResource } from '../src/resource-activity.mjs';

// Use the viewer's own cache: one download/parse, then configure scale BEFORE
// the scene initializes skeletons and computes its framing.
export async function preloadModel(viewer, source, progress, item) {
  const url = new URL(source, location.href).href;
  const loader = viewer[$renderer].loader;
  loader[$loader].setMeshoptDecoder(MeshoptDecoder);
  const policy = loader[$evictionPolicy];
  policy.retain(url);
  let released = false;
  const release = () => { if (!released) { released = true; policy.release(url); } };
  const finish = resourceActivity.begin(url, 'resourceModel');
  try {
    if(item?.appearance && !CachingGLTFLoader.cache.has(url)){
      const geometryURL=new URL(item.model,location.href).href;
      const prepared=parseSharedHull(loader[$loader],viewer.assetSession,geometryURL,item.appearance)
        .then(raw=>new ModelViewerGLTFInstance(ModelViewerGLTFInstance.prepare(raw)));
      CachingGLTFLoader.cache.set(url,prepared);
      try {await prepared;} catch(error){CachingGLTFLoader.cache.delete(url);throw error;}
    }
    if (viewer.assetSession && new URL(url).pathname.endsWith('.gltf')) {
      const session = viewer.assetSession;
      // Retain the unmodified document: GLTFLoader annotates its working copy.
      viewer.baseDocument = await session.json(url);
      if (!CachingGLTFLoader.cache.has(url)) {
        const parserLoader = loader[$loader];
        const plugin = parser => {
          const image = parser.loadTextureImage.bind(parser);
          parser.loadTextureImage = (texture, sourceIndex, textureLoader) => {
            const uri = parser.json.images[sourceIndex]?.uri;
            return uri && !uri.startsWith('data:')
              ? trackResource(new URL(uri, url).href, () => image(texture, sourceIndex, textureLoader), 'resourceTexture')
              : image(texture, sourceIndex, textureLoader);
          };
          const load = parser.loadBuffer.bind(parser);
          parser.loadBuffer = index => {
            const buffer = parser.json.buffers[index];
            if (!buffer.uri) return load(index);
            const href = new URL(buffer.uri, url).href;
            const key = JSON.stringify([href, buffer.byteLength]);
            return session.buffer(key, async () => {
              const bytes = await loadArrayBuffer(href, undefined, 'resourceModel');
              if (bytes.byteLength < buffer.byteLength)
                throw new Error(`Incomplete glTF buffer: ${buffer.uri} (${bytes.byteLength}/${buffer.byteLength} bytes)`);
              return bytes;
            });
          };
          return {name:'EVE_shared_buffers'};
        };
        parserLoader.register(plugin);
        parserLoader.register(surfaceDDSPlugin);
        let parsed;
        try { parsed = parserLoader.parseAsync(JSON.stringify(viewer.baseDocument), new URL('.', url).href); }
        finally { parserLoader.unregister(surfaceDDSPlugin); parserLoader.unregister(plugin); }
        const prepared = parsed.then(raw => new ModelViewerGLTFInstance(ModelViewerGLTFInstance.prepare(raw)));
        CachingGLTFLoader.cache.set(url, prepared);
        try { await prepared; }
        catch (error) { CachingGLTFLoader.cache.delete(url); throw error; }
      }
    }
    await loader.preload(url, viewer, progress);
    const gltf = await CachingGLTFLoader.cache.get(url);
    const dimensions = gltfDimensions(gltf.correlatedSceneGraph.gltf);
    return { dimensions, release };
  } catch (error) { finish(false); release(); throw error; }
  finally { finish(); }
}
