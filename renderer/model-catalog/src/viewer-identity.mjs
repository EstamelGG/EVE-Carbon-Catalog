import { factionIconPath, resolveViewerAffiliation } from './viewer-affiliation.mjs';

export function resolveViewerIdentity(item, explicit = {}) {
  const affiliation = resolveViewerAffiliation(item, explicit);
  return { ...affiliation, factionIconPath: factionIconPath(affiliation.factionID) };
}
