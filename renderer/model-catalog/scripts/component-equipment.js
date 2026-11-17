import { equipmentChoices } from './equipment-list.js';
import {loadFittingData} from '../src/fitting-data.mjs';

// All programmatic fits use the same transactional allocator as the controls.
export async function configureEquipment({
  viewer,
  item,
  options,
  equipmentIds,
  renderer,
  nativePreview,
  translate: t,
  isCurrent,
}) {
  const checkCurrent = () => {
    if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
  };
  const embedded = (viewer.appearanceDocument || viewer.originalGltfJson)?.extras?.ccpdec?.locators?.hardpoints;
  const fittingData = await loadFittingData(item, url => viewer.assetSession.json(url), embedded);
  checkCurrent();
  if (fittingData.version !== 2) throw Error('Fitting metadata version 2 is required');
  const locators = embedded ?? fittingData.ships?.[item.id];
  if (!locators?.length) throw Error('No compatible equipment mounts');
  const equipment = fittingData.equipment.filter((item) => item.supported !== false);
  if (!viewer.fitting) {
    const settings = nativePreview ? await viewer.assetSession.json(nativePreview) : {};
    checkCurrent();
    viewer.lifecycle.set(
      'fitting',
      renderer.installFitting(viewer, {
        locators,
        slots: fittingData.slots,
        equipment,
        settings,
        appearance: fittingData.appearance,
        dna: item.dna,
        hullCategory: fittingData.hullCategory ?? item.categoryID,
      }),
    );
  }
  let choices;
  if (equipmentIds !== undefined) {
    try {
      choices = equipmentChoices(equipmentIds, locators, equipment,
        fittingData.hullCategory ?? item.categoryID, fittingData.slots);
    } catch (error) {
      if (error.equipmentIndex !== undefined)
        error.message = t('equipmentCannotFit', {
          index: error.equipmentIndex + 1,
          itemId: error.itemId,
          reason: error.cause?.message || error.message,
        });
      throw error;
    }
  } else {
    choices =
      options.fitting === undefined
        ? new Map(
            viewer.fitting.slots.flatMap(({ slot }) =>
              viewer.fitting.get(slot) ? [[slot, viewer.fitting.get(slot).id]] : [],
            ),
          )
        : new Map();
    for (const entry of options.fitting?.equipment || []) {
      if (!Number.isSafeInteger(entry.slot) || choices.has(entry.slot))
        throw Error('Invalid or duplicate logical equipment slot');
      choices.set(entry.slot, entry.itemId);
    }
  }
  checkCurrent();
  // Stage the complete list and commit it together; failures retain the old fit.
  await viewer.fitting.replace(choices);
  checkCurrent();
  viewer.fitting.setDeployed(options.fitting?.deployed !== false);
  viewer.fitting.setEditing(!!options.showHardpoints);
}
