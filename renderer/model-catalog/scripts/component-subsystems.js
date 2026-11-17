import {
  subsystemColors,
  subsystemConfiguration,
  subsystemOptionAvailable,
  subsystemOptionName,
  subsystemSlots,
} from '../src/subsystems.mjs';

// Subsystem controls belong to the viewer. The catalog only observes selection changes.
export function createSubsystemPanel(root, { state, configure, runtime, translate: t, name }) {
  const $ = (id) => root.getElementById(id);
  function render() {
    const { baseItem, item } = state(),
      config = baseItem && subsystemConfiguration(baseItem, item?.subsystemSelection);
    $('subsystem-settings').hidden = item?.groupID !== 963;
    $('subsystem-not-applicable').hidden = item?.groupID === 963;
    if (item?.groupID !== 963) return;
    const focused = root.activeElement?.dataset.subsystemSlot;
    $('subsystem-options').replaceChildren(
      ...(config?.spec.slots || []).map((slot, index) => {
        const label = document.createElement('label'),
          caption = document.createElement('span'),
          select = document.createElement('select');
        label.className = 'subsystem-field';
        label.style.setProperty('--subsystem-color', subsystemColors[index]);
        caption.textContent = t('subsystem' + slot.key);
        select.dataset.subsystemSlot = index;
        select.setAttribute('aria-label', caption.textContent);
        select.disabled = !config.code;
        if (!config.code) select.add(new Option(t('subsystemDefault'), ''));
        for (const option of slot.options) {
          const row = new Option(subsystemOptionName(name(option.name)), String(option.variant));
          row.disabled = !subsystemOptionAvailable(config, index, option.variant);
          select.add(row);
        }
        select.value = config.code?.[index] || '';
        label.append(caption, select);
        return label;
      }),
    );
    $('subsystem-status').textContent = config?.code
      ? t('subsystemReady', { ready: config.readyCount, total: config.total })
      : t('subsystemUnavailable');
    $('reset-subsystems').disabled =
      !config?.defaultAvailable || config.code === config.spec.default;
    $('show-subsystem-labels').disabled = !runtime.viewer?.disposeSubsystemLabels;
    runtime.viewer?.disposeSubsystemLabels?.refresh?.();
    if (focused != null)
      $('subsystem-options').querySelector(`[data-subsystem-slot="${focused}"]`)?.focus();
  }
  $('subsystem-options').onchange = (event) => {
    const code = [...(state().item?.subsystemSelection || '')];
    if (!code.length) return;
    code[Number(event.target.dataset.subsystemSlot)] = event.target.value;
    configure({ subsystems: code.join('') });
  };
  $('reset-subsystems').onclick = () =>
    configure({ subsystems: state().baseItem?.subsystems?.default });
  $('show-subsystem-labels').onclick = () => runtime.viewer?.disposeSubsystemLabels?.show?.();
  return {
    render,
    install(viewer, item, module) {
      if (item.groupID !== 963 || !item.subsystemParts) return;
      viewer.lifecycle.set(
        'disposeSubsystemLabels',
        module.installSubsystemLabels(viewer, () =>
          item.subsystemParts.map((part, i) => ({
            title: t('subsystem' + subsystemSlots[i]),
            name: subsystemOptionName(name(part.name)),
          })),
        ),
      );
    },
  };
}
