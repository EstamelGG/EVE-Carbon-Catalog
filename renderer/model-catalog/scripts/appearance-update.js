import { prepareNativePreview } from './native-viewer.js';
import { installShipEffects } from './ship-effects.js';
import { prepareAppearanceTransaction } from './appearance-transaction.js';

export function prepareAppearanceUpdate(viewer, inputs, request) {
  return prepareAppearanceTransaction(viewer, inputs, request, {prepareNativePreview, installShipEffects});
}
