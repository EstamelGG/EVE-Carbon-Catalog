// Shared display rules for the gallery and the standalone component.
export function formatDimension(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  const rounded = Math.round(meters);
  return rounded >= 1000 ? `${Number((rounded / 1000).toFixed(2))}KM` : `${rounded}M`;
}

export function renderViewerHeading(
  root,
  item,
  title,
  { faction = '', factionIcon = '', type = '', skin = '' } = {},
) {
  root.getElementById('stage-title').textContent = title;
  const factionNode = root.getElementById('stage-faction');
  const factionIconNode = root.getElementById('stage-faction-icon');
  if (factionIcon) factionIconNode.src = factionIcon;
  else factionIconNode.removeAttribute('src');
  if (faction) factionNode.setAttribute('aria-label', faction);
  else factionNode.removeAttribute('aria-label');
  factionNode.hidden = !factionIcon;
  const subtitle = root.getElementById('stage-subtitle');
  const details = [item.name?.en !== title ? item.name?.en : '', type, skin].filter(Boolean);
  subtitle.textContent = details.join(' / ');
  subtitle.hidden = !details.length;
}
