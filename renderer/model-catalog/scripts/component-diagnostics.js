// Plain-data snapshot: keep live renderer objects out of copied reports.
export function diagnosticsContext({
  viewer,
  item,
  options = {},
  settings = {},
  placements = [],
  name = (value) => value?.en || value?.zh || '',
  labels = {},
}) {
  const source = viewer?.skybox?.exportSource?.entry;
  const composer = viewer?.querySelector?.('effect-composer');
  const activePass = (tag) => {
    const effect = composer?.querySelector(tag);
    if (!effect) return null;
    // Lit reflects blendMode as uppercase. Read runtime disabled flags after
    // the effect has updated; attributes alone can misreport SKIP as active.
    if (effect.effects?.length) return effect.effects.some((entry) => !entry.disabled);
    return String(effect.getAttribute('blend-mode') || 'default').toUpperCase() !== 'SKIP';
  };
  const selection = viewer?.hangar?.selection;
  const orbit = viewer?.getCameraOrbit?.(),
    target = viewer?.getCameraTarget?.();
  return {
    itemId: item?.id,
    model: item?.model,
    item: item
      ? {
          id: item.id,
          name: name(item.name),
          names: item.name,
          dna: item.dna,
          categoryID: item.categoryID,
          groupID: item.groupID,
          renderKind: item.renderKind,
          dimensions: viewer?.sourceDimensions,
        }
      : null,
    scene: {
      background: {
        requested: options.background || 'auto',
        label: labels.background,
        active: source
          ? {
              id: source.id,
              label:
                typeof source.name === 'object' ? name(source.name) : source.label || source.name,
              url: source.url,
            }
          : null,
        loading: !!viewer?.backgroundLoading,
        suppressedByHangar: !!viewer?.hangarActive,
      },
      hangar: {
        active: !!viewer?.hangarActive,
        requested: options.hangar || null,
        selection: selection ? { ...selection } : null,
        roomLabel: labels.room,
        shipLabel: labels.ship,
        phase: viewer?.dataset?.hangarPhase || null,
      },
      equipment: placements,
      subsystems: {
        selection: item?.subsystemSelection || null,
        parts: (item?.subsystemParts || []).map((part) => ({ id: part.id, name: name(part.name) })),
      },
      animation: {
        name: viewer?.animationName || null,
        paused: viewer?.paused ?? null,
        time: viewer?.currentTime ?? null,
        duration: viewer?.duration ?? null,
      },
      camera: {
        orbit: orbit ? { theta: orbit.theta, phi: orbit.phi, radius: orbit.radius } : null,
        target: target ? { x: target.x, y: target.y, z: target.z } : null,
        fieldOfView: viewer?.getFieldOfView?.() ?? null,
      },
    },
    configuration: {
      render: { ...(viewer?.renderSettings || settings.render) },
      display: { ...(viewer?.displaySettings || settings.display) },
      autoRotate: viewer ? !!viewer.autoRotate : !!options.autoRotate,
      invertWheel: !!options.invertWheel,
      killCount: viewer?.killCount ?? options.killCount ?? 0,
      powerPreference: options.powerPreference || 'high-performance',
      postprocessing: composer
        ? {
            msaa: Number(composer.getAttribute('msaa') || 0),
            smaa: activePass('smaa-effect'),
            occlusion: activePass('ssao-effect'),
            bloom: activePass('bloom-effect'),
            depthOfField: activePass('eve-depth-of-field'),
          }
        : null,
      postprocessingBudget: viewer?.postprocessingBudget
        ? { ...viewer.postprocessingBudget }
        : null,
      availableTextureRoles: viewer?.availableTextureRoles
        ? [...viewer.availableTextureRoles]
        : null,
    },
    settings,
    options,
  };
}
