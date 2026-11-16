import {
  normalizeDisplaySettings,
  textureRoles,
  performanceControls,
} from '../src/display-settings.mjs';
import { normalizeKillCount } from '../src/kill-count.mjs';

// Controls update instance-owned state; persistence belongs to the embedding application.
export function bindNativeVisualPanel(root, { state, update, runtime, emit, selectBackground }) {
  const $ = (id) => root.getElementById(id);
  const renderKeys = [
    'exposure',
    'reflection',
    'bloom',
    'sun',
    'fill',
    'f0',
    'roughness',
    'dirt',
    'depthOfField',
  ];
  let catalog, lastTranslate;
  const report = (error) => emit('error', { message: error.message });
  for (const key of renderKeys)
    $(key).oninput = () =>
      update({ render: { [key]: Number($(key).value) } });
  for (const [key, id] of Object.entries(performanceControls)) {
    $(id).onchange = () => {
      const options = state().options;
      if (key === 'noColor') update({ whiteModel: $(id).checked });
      else if (key === 'effects') update({ effects: $(id).checked });
      else
        update({
          display: {
            ...options.display,
            ...(key === 'antialias' ? { antialiasMode: $(id).value } : { [key]: $(id).checked }),
          },
        });
    };
  }
  for (const role of textureRoles)
    $('texture-' + role).onchange = () => {
      const options = state().options;
      update({
        display: {
          ...options.display,
          textures: { ...options.display?.textures, [role]: $('texture-' + role).checked },
        },
      });
    };
  $('show-textures').onchange = () => {
    const options = state().options;
    update({
      display: {
        ...options.display,
        textures: Object.fromEntries(
          textureRoles.map((role) => [role, $('show-textures').checked]),
        ),
      },
    });
  };
  $('auto-rotate').onchange = () => update({ autoRotate: $('auto-rotate').checked });
  $('invert-wheel').onchange = () => update({ invertWheel: $('invert-wheel').checked });
  $('show-damage').onchange = () => update({ damage: $('show-damage').checked });
  const kills = (value) => update({ killCount: normalizeKillCount(value) });
  $('kill-count').oninput = () => kills($('kill-count').value);
  $('kill-count-input').oninput = () => {
    if ($('kill-count-input').value !== '' && !$('kill-count-input').validity.badInput)
      kills($('kill-count-input').value);
  };
  $('kill-count-input').onchange = () => kills($('kill-count-input').value);
  $('skybox-select').onchange = () => {
    const background = $('skybox-select').value;
    state().options.background = background;
    selectBackground(background).catch(report);
    emit('settings-change', { background });
  };
  $('reset-render').onclick = () =>
    update({
      render: null,
      display: normalizeDisplaySettings(),
      effects: true,
      whiteModel: false,
      damage: false,
    });
  $('gate-state').onchange = () =>
    runtime.viewer?.shipEffects?.gate?.setState($('gate-state').value);
  $('gate-arrival').onclick = () => runtime.viewer?.shipEffects?.gate?.trigger('arrival');
  $('gate-departure').onclick = () => runtime.viewer?.shipEffects?.gate?.trigger('departure');
  return {
    sync() {
      const { options, settings, backgroundCatalog, t } = state(),
        viewer = runtime.viewer;
      $('panel').hidden = !options.controlPanel;
      $('gpu-preference').value=options.powerPreference||'high-performance';
      $('skybox-select').disabled = !viewer || !backgroundCatalog || !!viewer.hangarActive;
      const damageToggle = $('show-damage');
      damageToggle.disabled = !viewer?.locatorDamage && !viewer?.shipEffects?.hasDamage;
      damageToggle.checked = !damageToggle.disabled && options.damage === true;
      if (!settings) return;
      for (const key of renderKeys) {
        $(key).value = settings.render[key];
        $(key + '-value').value = settings.render[key].toFixed(1);
      }
      for (const [key, id] of Object.entries(performanceControls)) {
        if (key === 'antialias') $(id).value = settings.display.antialiasMode;
        else $(id).checked = settings.display[key];
      }
      $('auto-rotate').checked = !!options.autoRotate;
      $('invert-wheel').checked = !!options.invertWheel;
      const roles = viewer?.availableTextureRoles;
      for (const role of textureRoles) {
        const input = $('texture-' + role);
        input.checked = settings.display.textures[role];
        input.disabled = !roles || !roles.has(role);
      }
      const enabled = textureRoles
        .map((role) => $('texture-' + role))
        .filter((input) => !input.disabled);
      $('show-textures').checked = enabled.every((input) => input.checked);
      $('show-textures').indeterminate =
        enabled.some((input) => input.checked) && !$('show-textures').checked;
      $('dirt').disabled = !roles || !roles.has('DirtMap');
      $('show-textures').disabled = !roles;
      $('depthOfField').disabled = !settings.display.depthOfField;
      const hasKills = (viewer?.killMarkCount || 0) > 0;
      for (const id of ['kill-count', 'kill-count-input']) {
        $(id).disabled = !hasKills;
        $(id).value = normalizeKillCount(options.killCount);
      }
      $('kill-count-unavailable').hidden = hasKills;
      if (catalog !== backgroundCatalog || lastTranslate !== t('skyboxNone')) {
        catalog = backgroundCatalog;
        lastTranslate = t('skyboxNone');
        const select = $('skybox-select');
        select.replaceChildren(
          new Option(t('skyboxAuto'), 'auto'),
          new Option(t('skyboxNone'), 'none'),
        );
        for (const scene of catalog?.scenes || [])
          select.add(
            new Option(
              scene.label || scene.name?.zh || scene.name?.en || scene.name || scene.id,
              scene.id,
            ),
          );
      }
      $('skybox-select').value = options.background;
      if(viewer?.shipEffects?.gate)$('gate-state').value=viewer.shipEffects.gate.state;
      $('gate-state-row').hidden = $('gate-events').hidden = false;
      $('gate-state').disabled = !viewer?.shipEffects?.gate;
      for (const button of $('gate-events').querySelectorAll('button')) button.disabled = !viewer?.shipEffects?.gate;
    },
  };
}
