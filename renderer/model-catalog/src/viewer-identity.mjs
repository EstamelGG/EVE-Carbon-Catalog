import { factionIconSource, resolveViewerAffiliation } from './viewer-affiliation.mjs';

export function resolveViewerIdentity(item, explicit = {}) {
  const affiliation = resolveViewerAffiliation(item, explicit);
  return {
    ...affiliation,
    factionIconSource: factionIconSource(affiliation.factionID, item.id ?? explicit.id),
  };
}
