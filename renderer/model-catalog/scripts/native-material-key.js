import {patternRoles} from './projected-patterns.js';
import { hasDetail } from './detail-material.js';
import { hasEnvironment } from './environment-material.js';
import { isGlassMaterial } from './glass-material.js';

// Include every source-dependent shader branch. Texture identities and uniform
// values deliberately stay out so identical programs can still be shared.
export function nativeMaterialKey(native) {
  return JSON.stringify([
    'eve-native-v2', native.profile, isGlassMaterial(native),
    !!native.textures?.SailsDetailMap, patternRoles(native),
    hasDetail(native), hasEnvironment(native),
    native.clip ? Number(native.clip.uvMix !== 0) : null,
  ]);
}
