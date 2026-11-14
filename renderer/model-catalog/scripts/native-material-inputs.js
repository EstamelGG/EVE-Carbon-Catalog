// SOURCE AUDIT 2026-11-11 [L01-L02/M01-M04]: Reviewed with unresolved game-specific terms/policies; see consolidated report for limited public matches.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// Extracted unchanged from first-generation native-preview-scope.js.
// Legacy F0 and dust diffuse use sRGB PNGs; the packed dust controls use linear RGB8.
// See docs/line-audit/legacy-bake.md for historical writers and GPU readback.
import {patternRoles} from './projected-patterns.js';
import {runtimeProfile} from './runtime-material.js';
import {DataTexture, SRGBColorSpace, NoColorSpace, RepeatWrapping, MirroredRepeatWrapping, ClampToEdgeWrapping} from 'three';

// Queue all texture requests before installing materials. Observing each
// rejection immediately preserves error reporting for concurrently loaded maps.
export function queueMaterialInputs(
  definitions,
  materialRoot,
  modelUrl,
  { loadTexture, textureCache, resources, anisotropy, surfaceIndex, typeID },
) {
  const materialInputs = new Map();
  for (const definition of definitions) {
    const native = definition.extras?.ccpdecNative;
    if (!native) throw new Error('Missing source material inputs: ' + definition.name);
    const original=surfaceIndex.get(definition.name)?.at(-1)?.material;
    if (!original || native.profile === 'fx-surface-v1') continue;
    const runtime = native.profile === runtimeProfile;
    const loaded = {};
    const roles = patternRoles(native);
    const pending = Promise.all(
      Object.entries(native.textures).map(async ([role, url]) => {
        const href = new URL(url, new URL(modelUrl, location.href)).href;
        const colorSpace = runtime
          ? role === 'AlbedoMap'
            ? SRGBColorSpace
            : NoColorSpace
          : role === 'dust_surface'
            ? NoColorSpace
            : SRGBColorSpace;
        const channel = runtime ? 0 : original.map?.channel || 0;
        // Use the same explicit or legacy positional slot as the shader program.
        // CCP address enums: https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinityal/Tr2RenderContextEnum.h#L360-L366
        const mask = native.patterns?.[roles.indexOf(role)];
        const wrapping = (mode) =>
          mode === 2
            ? MirroredRepeatWrapping
            : mode === 3 || mode === 4
              ? ClampToEdgeWrapping
              : RepeatWrapping;
        const wrapS = wrapping(mask?.addressU),
          wrapT = wrapping(mask?.addressV);
        const key = JSON.stringify([href, colorSpace, channel, wrapS, wrapT]);
        if (!textureCache.has(key))
          textureCache.set(
            key,
            loadTexture(href).then((texture) => {
              resources.own(texture);
              texture.flipY = false;
              texture.wrapS = wrapS;
              texture.wrapT = wrapT;
              texture.colorSpace = colorSpace;
              texture.channel = channel;
              texture.anisotropy = anisotropy;
              texture.needsUpdate = true;
              return texture;
            }),
          );
        try {
          loaded[role] = await textureCache.get(key);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          console.error('[eve-model-viewer] Surface texture skipped', {typeID, material:definition.name, role, url:href}, error);
          const neutralKey=key+'|missing:'+role;
          if (!textureCache.has(neutralKey)) {
            const pixel=role==='NormalMap' ? [128,128,255,255] :
              ['AlbedoMap','basecolor','AoMap'].includes(role) ? [255,255,255,255] : [0,0,0,0];
            const neutral=resources.own(new DataTexture(new Uint8Array(pixel),1,1));
            neutral.colorSpace=colorSpace;
            neutral.needsUpdate=true;
            textureCache.set(neutralKey,neutral);
          }
          loaded[role]=textureCache.get(neutralKey);
        }
      }),
    );
    // Later materials may fail before the first one finishes. Observe every
    // promise immediately; awaiting it below still reports the original error.
    pending.catch(() => {});
    materialInputs.set(definition, { loaded, pending });
  }

  return materialInputs;
}

