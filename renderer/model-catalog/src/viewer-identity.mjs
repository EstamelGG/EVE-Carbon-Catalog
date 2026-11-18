import { resolveViewerAffiliation } from './viewer-affiliation.mjs';
import { defaultLogo, factionIcons } from './viewer-identity-icons.mjs';

export function resolveViewerIdentity(item, explicit = {}) {
  const affiliation = resolveViewerAffiliation(item, explicit);
  const factionIcon =
    affiliation.kind === 'faction' ? factionIcons.get(affiliation.factionID) : null;
  return { ...affiliation, factionIcon: factionIcon || defaultLogo };
}
