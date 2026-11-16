import {assembleEffects} from './effects-template.js';
import { createEffectResources } from './effect-resources.js';
import { resourceURL } from '../src/resource-location.mjs';
import { loadJSON, loadArrayBuffer } from '../src/resource-activity.mjs';
import { createHangarBundleCache } from './hangar-bundle-cache.js';
import {pageResourceCache} from './page-resource-cache.js';

// One open dialog owns the decoded shared textures and metadata. Appearance
// scopes borrow them; only closing the dialog releases their storage.
export function createViewerSession(resolveURL = resourceURL) {
  const bundles = createHangarBundleCache(resolveURL);
  const resources = createEffectResources(undefined, resolveURL, bundles.objectURL), documents = new Map(), reflections = new Map(), buffers = new Map();
  const localTexture=resources.texture;
  resources.texture=(record,options)=>{
    const url=new URL(resolveURL(record.url),location.href).href;
    return !record.video&&pageResourceCache.hot(url)
      ?pageResourceCache.resources(()=>createEffectResources(undefined,url=>url)).texture({...record,url},options)
      :localTexture(record,options);
  };
  return {
    resources, reflections, resolveURL, bundles,
    binaryURL: bundles.objectURL,
    arrayBuffer(url, options, kind) {
      const href=new URL(resolveURL(url),location.href).href;
      return pageResourceCache.load('bytes',href,()=>bundles.has(url) ? Promise.resolve(bundles.arrayBuffer(url)) : loadArrayBuffer(href, options, kind));
    },
    buffer(key, load) {
      if (!buffers.has(key)) buffers.set(key, pageResourceCache.load('buffer',key,load,key.startsWith('effect-accessors ')?key.slice(17):key).catch(error => { buffers.delete(key); throw error; }));
      return buffers.get(key);
    },
    json(url) {
      const key = new URL(resolveURL(url), location.href).href;
      if (!documents.has(key)) {
        let pending;
        try { pending = pageResourceCache.hot(key)
          ?pageResourceCache.load('json',key,()=>loadJSON(key)).then(value=>structuredClone(value))
          :bundles.has(url) ? Promise.resolve(bundles.json(url)) : loadJSON(key); }
        catch (error) { pending = Promise.reject(error); }
        pending=Promise.resolve(pending).then(value=>{
          if(value?.kind!=='sof-hull-effects')return value;
          const dna=new URL(key).searchParams.get('dna');
          if(!dna)throw Error('Hull effects require DNA');
          return assembleEffects(value,dna,path=>this.json(path));
        });
        documents.set(key, pending.catch(error => { documents.delete(key); throw error; }));
      }
      return documents.get(key);
    },
    remember(url, value) { documents.set(new URL(resolveURL(url), location.href).href, Promise.resolve(value)); },
    dispose() { this.skybox?.dispose(); resources.dispose(); bundles.dispose(); documents.clear(); reflections.clear(); buffers.clear(); },
  };
}
