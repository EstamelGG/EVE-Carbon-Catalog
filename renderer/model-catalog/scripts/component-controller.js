import {locatorFire} from './locator-fire.js';
import {frameIcon, renderIcon} from './icon-camera.js';
import {selectIconScene} from './icon-scene.js';
import { diagnosticsContext } from './component-diagnostics.js';
import { createPerformancePanel } from './component-performance.js';
import { configureEquipment } from './component-equipment.js';
import { createViewerRuntime } from '../src/viewer-runtime.mjs';
import { createViewerTransition } from '../src/viewer-transition.mjs';
import { componentResourceKey, createComponentResources } from './component-resources.js';
import { normalizeRenderSettings, renderDefaultsForDNA } from '../src/render-settings.mjs';
import { normalizeDisplaySettings } from '../src/display-settings.mjs';
import { loadJSON } from '../src/resource-activity.mjs';
import { createLoadingPanel } from '../src/loading-panel.mjs';
import { formatDimension, renderViewerHeading } from '../src/viewer-overlay.mjs';
import { normalizeKillCount } from '../src/kill-count.mjs';
import * as renderer from './viewer-entry.js';
import { resetView } from '../src/view-reset.mjs';
import { configureHullAnimations } from '../src/viewer-presentation.mjs';
import { equipmentList } from './equipment-list.js';
import { createFittingPanel } from '../src/fitting-panel.mjs';
import { createHangarPanel, supportsHangar } from '../src/hangar-panel.mjs';
import { createSubsystemPanel } from './component-subsystems.js';
import { bindViewerActions } from './component-actions.js';
import { componentLocale } from '../src/locale.mjs';
import { installOrbitTurns } from './orbit-turns.js';
import panelMarkup from './viewer-panels.html';
import { messages } from '../src/messages.mjs';
import { bindNativeVisualPanel } from './component-visual.js';
import { withSubsystems, subsystemItem, subsystemGroups } from '../src/subsystems.mjs';

export function createComponentController(root, emit) {
  const $ = (id) => root.getElementById(id);
  $('panel').innerHTML = panelMarkup;
  let language = componentLocale();
  const t = (key, values = {}) =>
    (messages[key]?.[language === 'en' ? 1 : 0] || key).replace(
      /\{(\w+)\}/g,
      (_, name) => values[name] ?? '',
    );
  const name = (value) => value?.[language === 'en' ? 'en' : 'zh'] || value?.en || value?.zh || '';
  function setLanguage(choice) {
    language = componentLocale(choice);
    for (const node of root.querySelectorAll('[data-i18n]'))
      node.textContent = t(node.dataset.i18n);
    for (const attribute of ['aria-label', 'placeholder', 'title'])
      for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`))
        node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
    for (const option of $('hull-animation').options)
      option.textContent = t(option.value.split('.').pop());
    if (currentItem) {
      renderViewerHeading(root, currentItem, name(currentItem.name) || `ID ${currentItem.id}`);
      runtime.viewer?.setAttribute('alt', t('modelAlt', { name: name(currentItem.name) }));
    }
    loading.refresh();
    controls.sync();
    fittingPanel.render();
    hangarPanel.render();
    subsystems.render();
  }
  const animationRow = $('hull-animation-row'),
    animationSelect = $('hull-animation');
  const playAnimation = (viewer) => {
    if (viewer.equipmentPreview) {
      const name = viewer.animationName;
      viewer.pause();
      void viewer.updateComplete.then(() => {
        if (viewer.isConnected && viewer.animationName === name)
          viewer.currentTime = Math.max(0, viewer.duration - 0.001);
      });
      return;
    }
    const transition = /2|^Start|^End/.test((viewer.animationName || '').split('.').pop());
    viewer.play({ repetitions: transition ? 1 : Infinity });
  };
  animationSelect.onchange = () => {
    if (runtime.viewer) {
      runtime.viewer.animationName = animationSelect.value;
      playAnimation(runtime.viewer);
    }
  };

  let requests = new AbortController();
  const json = (url) => loadJSON(url, { signal: requests.signal });
  let options = {},
    resources,
    settings,
    lastError,
    revision = 0,
    currentItem,
    backgroundTask;
  let fittingData, loadedItem, backgroundCatalog, baseItem;
  let panelRender = {};
  let panelDNA;
  function resolvedRender(dna) {
    return normalizeRenderSettings({ ...renderDefaultsForDNA(dna), ...options.render, ...panelRender });
  }
  $('official-skin').onchange=()=>{
    requestConfigure({officialSkin:$('official-skin').value});
  };
  const resolveURL = (url) => resources.resolveURL(url);
  let tab = 'visual';
  const loading = createLoadingPanel({
    root,
    translate: t,
    backgroundPending: () => !!runtime.viewer?.backgroundLoading,
    automaticResources: false,
  });
  $('viewer-loading').hidden = true;
  const runtime = createViewerRuntime({
    mount: $('mount'),
    transition: createViewerTransition($('viewer-stage'), $('snapshot')),
    loadRenderer: async () => renderer,
    resolveURL: (url) => resolveURL(url),
    createSession: (module) => Object.assign(module.createViewerSession((url) => resolveURL(url)),{bannerImages:options.bannerImages}),
    view: {
      dimensionFrame: $('dimension-frame'),
      label: (item) => t('modelAlt', { name: name(item.name) || String(item.id) }),
      settings: () => settings,
      batch: () => loading.batch,
      dimensions(item, size) {
        renderViewerHeading(root, item, name(item.name) || `ID ${item.id}`);
        for (const axis of ['x', 'y', 'z'])
          $('dimension-' + axis).textContent = formatDimension(size?.[axis]);
      },
      progress: (phase, detailKey) => {
        loading.progress(phase, detailKey);
        emit('progress', { phase, total: 5 });
      },
      begin(item) {
        lastError = null;
        fittingPanel.reset();
        hangarPanel.reset();
        if (!loading.batch) loading.begin();
        renderViewerHeading(root, item, name(item.name) || `ID ${item.id}`);
      },
      reset() {
        loadedItem = null;
        fittingPanel.reset();
        hangarPanel.reset();
        for (const axis of ['x', 'y', 'z']) $('dimension-' + axis).textContent = '—';
      },
      connected(viewer, module) {
        const gpu = module.viewerGPU(viewer);
        $('gpu').textContent =
          gpu.match(/^ANGLE \([^,]+, (.+?)(?: \(0x[\da-f]+\))? (?:Direct3D|Vulkan|OpenGL)/i)?.[1] ||
          gpu;
        $('gpu').title = gpu;
        emit('gpu', { name: gpu });
        viewer.lifecycle.set(
          'disposeOrbitTurns',
          installOrbitTurns(viewer, (state) => emit('orbit-turns-change', state)),
        );
        viewer.lifecycle.set(
          'disposeFPS',
          module.watchViewerFPS(viewer, (fps) => {
            $('fps').textContent = `${fps ?? '—'} FPS`;
          }),
        );
        let forwarding = false;
        viewer.lifecycle.listen(
          viewer.shadowRoot,
          'wheel',
          (event) => {
            if (forwarding) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            forwarding = true;
            try {
              viewer.zoom(
                ((options.invertWheel ? -1 : 1) * event.deltaY * (event.deltaMode === 1 ? 18 : 1)) /
                  30,
              );
            } finally {
              forwarding = false;
            }
          },
          { capture: true, passive: false },
        );
      },
      installed(viewer, item, module, kind) {
        if (kind === 'model')
          viewer.lifecycle.set(
            'disposeHullAnimations',
            configureHullAnimations(viewer, {
              row: animationRow,
              select: animationSelect,
              translate: t,
              play: playAnimation,
              isActive: () => runtime.viewer === viewer,
            }),
          );
        const source = (viewer.appearanceDocument || viewer.originalGltfJson)?.extras?.ccpdec;
        viewer.lifecycle.release('locatorDamage');
        if (source?.locators?.vdsTrail?.length && source.hullFire)
          viewer.lifecycle.set('locatorDamage', locatorFire(viewer, source.locators.vdsTrail, source.sourceRadius || Math.max(...Object.values(viewer.getDimensions()))/2, source.hullFire));
        subsystems.install(viewer, item, module);
        fittingPanel.connect(viewer, item, module);
        hangarPanel.connect(viewer, item, module);
      },
      environment(viewer, module) {
        viewer.backgroundLoading = true;
        backgroundCatalog = undefined;
        $('skybox-status').hidden = true;
        backgroundTask = (async () => {
          const catalog = await viewer.assetSession.json('res/backgrounds.json');
          if (runtime.viewer !== viewer) return;
          if (!Array.isArray(catalog?.scenes) || !catalog.defaults) throw Error('Invalid background catalog');
          backgroundCatalog = catalog;
          viewer.lifecycle.set('skybox', module.createSkybox(viewer, catalog, viewer.previewRace));
          await viewer.skybox.select(options.background || 'auto');
        })();
        backgroundTask = backgroundTask.catch(() => {
          if (runtime.viewer === viewer) {
            backgroundCatalog = undefined;
            $('skybox-status').textContent = t('skyboxError');
            $('skybox-status').hidden = false;
          }
        }).finally(() => {
          if (runtime.viewer === viewer) {
            viewer.backgroundLoading = false;
            loading.backgroundSettled();
            controls.sync();
            actions.sync();
          }
        });
        backgroundTask.catch(() => {});
        return backgroundTask;
      },
      ready() {
        loading.finish();
        actions.sync();
      },
      failed({ error, retained }) {
        lastError = error || Error('Model loading failed');
        if (retained) {
          currentItem = retained;
          loadedItem = `${retained.id}:${retained.subsystemSelection || ''}`;
          emit('selection-change', {
            itemId: retained.id,
            subsystems: retained.subsystemSelection,
          });
        }
      },
    },
  });
  const performancePanel = createPerformancePanel(root, {
    runtime, renderer, translate: t,
    context: () => {
      const label = (id, value) => {
        const select = $(id);
        const option = value === undefined ? select?.selectedOptions?.[0] : [...(select?.options || [])].find((option) => option.value === String(value));
        return option?.textContent || null;
      };
      const selection = runtime.viewer?.hangar?.selection;
      return diagnosticsContext({viewer: runtime.viewer, item: runtime.viewer?.readyItem || currentItem,
        options, settings, placements: placements(), name,
        labels: {background: label('skybox-select'), room: label('hangar-room', selection?.room), ship: label('hangar-ship', selection?.ship)}});
    },
  });
  async function selectBackground(value) {
    const viewer = runtime.viewer;
    if (!viewer?.skybox) return;
    const task = loading.beginTask('loadingResources');
    task.plan([]);
    viewer.backgroundLoading = true;
    actions.sync();
    try {
      await viewer.skybox.select(viewer.hangarActive ? 'none' : value);
    } finally {
      if (runtime.viewer === viewer) {
        viewer.backgroundLoading = false;
        task.finish();
        actions.sync();
      }
    }
  }
  function placements() {
    const fitting = runtime.viewer?.fitting;
    return fitting
      ? fitting.slots.flatMap(({ slot }) => {
          const entry = fitting.get(slot);
          return entry
            ? [
                {
                  slot,
                  itemId: entry.id,
                  nativeSlot: entry.nativeSlot,
                  locatorName: entry.prefix,
                  mounts: entry.mounts.map((m) => m.name),
                },
              ]
            : [];
        })
      : [];
  }
  const controls = bindNativeVisualPanel(root, {
    state: () => ({ options, settings, item: currentItem, backgroundCatalog, t }),
    update,
    runtime,
    emit,
    selectBackground,
  });
  const nativeSettings = (viewer) => settings.nativePreview ? viewer.assetSession.json(settings.nativePreview) : {};
  const loadResource = (url) => resources.load(url);
  const fittingPanel = createFittingPanel({
    saveRecent: (recentEquipment) => emit('settings-change', { recentEquipment }),
    root,
    currentViewer: () => runtime.viewer,
    currentItem: () => currentItem,
    translate: t,
    name,
    loading,
    nativeSettings,
    loadResource,
    groupName: (id) =>
      name(resources?.index?.categories?.flatMap((c) => c.groups).find((g) => g.id === id)?.name) || String(id),
  });
  const hangarPanel = createHangarPanel({
    root,
    currentViewer: () => runtime.viewer,
    currentItem: () => currentItem,
    translate: t,
    name,
    catalog: () => resources?.catalog,
    loading,
    nativeSettings,
    loadResource,
    onChange: (hangar) => {
      options.hangar = hangar;
      emit('settings-change', { hangar });
      actions.sync();
    },
    async background(viewer, active) {
      $('skybox-select').disabled = active;
      await viewer.skybox?.select(active ? 'none' : options.background);
      actions.sync();
    },
  });
  const requestConfigure = (patch) =>
    root.host.configure(patch).catch((error) => root.host._report(error));
  let powerRestore=null,powerResumeSequence;
  const powerClient={
    stop(owner){
      const viewer=runtime.viewer;
      if(viewer&&loadedItem)powerRestore={key:loadedItem,orbit:viewer.getCameraOrbit(),target:viewer.getCameraTarget(),
        fov:viewer.getFieldOfView(),fit:viewer.fitting?placements():null,fitKey:JSON.stringify([options.equipment,options.fitting])};
      const active=!!runtime.viewer||root.host._configuring;
      if(!owner)root.host.cancel();
      powerResumeSequence=root.host._sequence;
      runtime.close();loadedItem=null;
      return active;
    },
    sync(powerPreference){options.powerPreference=powerPreference;emit('settings-change',{powerPreference});controls.sync();},
    resume(powerPreference){if(root.host.isConnected&&(options.itemId||options.dna)&&root.host._sequence===powerResumeSequence)requestConfigure({powerPreference});},
  };
  const releasePower=renderer.renderPower.register(powerClient);
  $('gpu-preference').onchange=()=>requestConfigure({powerPreference:$('gpu-preference').value});
  const subsystems = createSubsystemPanel(root, {
    state: () => ({ baseItem, item: currentItem }),
    configure: requestConfigure,
    runtime,
    translate: t,
    name,
  });
  function selectTab(value) {
    tab = $('tab-' + value)?.hidden ? 'visual' : value;
    for (const button of root.querySelectorAll('[data-settings-tab]')) {
      const selected = button.dataset.settingsTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      $('panel-' + button.dataset.settingsTab).hidden = !selected;
    }
    fittingPanel.setActive(tab === 'fitting');
    if (tab === 'hangar') void hangarPanel.open();
    runtime.viewer?.disposeSubsystemLabels?.setEnabled?.(tab === 'subsystems');
    if (tab === 'subsystems') runtime.viewer?.disposeSubsystemLabels?.show?.();
  }
  for (const button of root.querySelectorAll('[data-settings-tab]')) {
    button.onclick = () => selectTab(button.dataset.settingsTab);
    button.onkeydown = (event) => {
      const buttons = [...root.querySelectorAll('[data-settings-tab]')].filter((b) => !b.hidden),
        i = buttons.indexOf(button);
      const next =
        event.key === 'ArrowRight'
          ? (i + 1) % buttons.length
          : event.key === 'ArrowLeft'
            ? (i + buttons.length - 1) % buttons.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : null;
      if (next !== null) {
        event.preventDefault();
        selectTab(buttons[next].dataset.settingsTab);
        buttons[next].focus();
      }
    };
  }
  function reset() {
    if (runtime.viewer?.hangar?.active) runtime.viewer.hangar.reset();
    else if (runtime.viewer) resetView(runtime.viewer);
  }
  const actions = bindViewerActions(root, {
    runtime,
    translate: t,
    name,
    reset,
    retry: () => requestConfigure({}),
    fullscreen: () => {
      if (root.host.hasAttribute('managed-fullscreen')) {
        emit('fullscreen-request', {});
        return;
      }
      const task = document.fullscreenElement
        ? document.exitFullscreen()
        : root.host.requestFullscreen();
      task?.catch((error) => emit('error', { message: error.message }));
    },
  });
  function renderPanel() {
    controls.sync();
    $('tab-subsystems').hidden = currentItem?.groupID !== 963;
    $('tab-hangar').hidden = !supportsHangar(currentItem);
    $('skybox-select').closest('label').hidden = currentItem?.renderKind === 'equipment';
    subsystems.render();
    selectTab(tab);
    actions.sync();
  }
  function update(patch) {
    if (!settings || !runtime.viewer) return;
    const { render, ...other } = patch;
    options = { ...options, ...other };
    if (render === null) {
      options.render = {};
      panelRender = {};
    } else if (render) Object.assign(panelRender, render);
    settings.render = resolvedRender(currentItem.dna);
    settings.display = normalizeDisplaySettings({
      ...options.display,
      effects: options.effects,
      noColor: options.whiteModel,
    });
    runtime.applyRenderSettings(settings.render);
    runtime.applyDisplaySettings(settings.display);
    runtime.viewer.autoRotate = !!options.autoRotate;
    runtime.viewer.killCount = normalizeKillCount(options.killCount);
    runtime.viewer.setKillCount?.(runtime.viewer.killCount);
    const damageViewer = runtime.viewer;
    damageViewer.damageEnabled = options.damage === true;
    (damageViewer.locatorDamage ? damageViewer.locatorDamage.setEnabled(damageViewer.damageEnabled) : damageViewer.shipEffects?.setDamage?.(damageViewer.damageEnabled))?.catch(error => {
      if (runtime.viewer === damageViewer) { options.damage = false; controls.sync(); }
      emit('error', {message: error.message});
    });
    controls.sync();
    emit('settings-change', patch);
  }
  async function configure(next) {
    const powerPreference=renderer.renderPower.select(next.powerPreference,powerClient);
    requests = new AbortController();
    const token = ++revision;
    options = {
      background: 'auto',
      effects: true,
      whiteModel: false,
      damage: false,
      autoRotate: false,
      controlPanel: false,
      ...next,
      powerPreference,
    };
    setLanguage(options.language);
    $('status').textContent = '';
    $('retry').hidden = true;
    loading.begin();
    emit('progress', { phase: 1, total: 5 });
    fittingPanel.setRecent(options.recentEquipment);
    const equipmentIds = equipmentList(options.equipment);
    const nextBase = componentResourceKey(options);
    if (resources?.key !== nextBase) {
      const nextResources = createComponentResources(nextBase, json);
      runtime.close();
      fittingPanel.resetResources();
      hangarPanel.resetResources();
      loadedItem = null;
      fittingData = null;
      resources = nextResources;
    }
    const useDNA = options.itemId == null && !!options.dna;
    const source = resources;
    if (!useDNA) await source.loadCatalog();
    const { index, catalog: loader } = source;
    const itemId = Number(options.itemId);
    if (!useDNA && (!Number.isSafeInteger(itemId) || itemId <= 0))
      throw Error('item-id must be a positive integer');
    let item = useDNA ? await source.dna(options.dna) : await source.publishedItem(await loader.item(itemId));
    if (token !== revision) throw new DOMException('Superseded', 'AbortError');
    if (options.itemIdentity?.id === item.id && options.itemIdentity.name)
      item = { ...item, name: options.itemIdentity.name };
    const skins=item.officialSkins?.[item.id]||[];
    const picker=$('official-skin');
    $('official-skin-row').hidden=!skins.length;
    picker.replaceChildren(new Option(t('skin'),''),...skins.map(s=>new Option(name(s.name)||String(s.id),String(s.id))));
    const skin=skins.find(s=>String(s.id)===String(options.officialSkin));
    if(skin){
      picker.value=String(skin.id);
      const styled=await source.officialSkin(skin);
      if(token!==revision)throw new DOMException('Superseded','AbortError');
      item={...styled,name:item.name,id:item.id,officialSkins:item.officialSkins};
    }
    baseItem = item;
    if (item?.groupID === 963 && item.subsystems) {
      await source.loadCatalog();
      const parts = (await Promise.all(subsystemGroups.map((group) => source.catalog.group(group)))).flat();
      if (token !== revision) throw new DOMException('Superseded', 'AbortError');
      baseItem = withSubsystems(item, parts);
      const assemblyBase = new URL(source.resolveURL('index.html'), document.baseURI);
      item = subsystemItem(baseItem, options.subsystems, assemblyBase);
      if (item.subsystemParts) {
        item.subsystemParts = await Promise.all(item.subsystemParts.map(async part => ({
          ...part, ...await source.publishedItem(part),
        })));
      }
    }
    if (!item?.model) throw Error(`No model for item ${itemId}`);
    if (token !== revision) throw new DOMException('Superseded', 'AbortError');
    if (panelDNA !== item.dna) panelRender = {};
    panelDNA = item.dna;
    currentItem = item;
    settings = {
      nativePreview: item.preview || index?.nativePreview,
      background: options.background,
      render: resolvedRender(item.dna),
      display: normalizeDisplaySettings({
        ...options.display,
        effects: options.effects,
        noColor: options.whiteModel,
      }),
      killCount: normalizeKillCount(options.killCount),
      autoRotate: !!options.autoRotate,
    };
    const itemKey = JSON.stringify([item.id,item.dna,item.model,item.subsystemSelection]);
    const restored=powerRestore?.key===itemKey?powerRestore:null;powerRestore=null;
    if (loadedItem !== itemKey) {
      if (!(await runtime.show(item)))
        throw lastError || new DOMException('Superseded', 'AbortError');
      loadedItem = itemKey;
    } else {
      runtime.applyRenderSettings(settings.render);
      runtime.applyDisplaySettings(settings.display);
      runtime.viewer.killCount = settings.killCount;
      runtime.viewer.setKillCount?.(settings.killCount);
      runtime.viewer.autoRotate = settings.autoRotate;
      runtime.viewer.skybox?.select(options.background)?.catch(() => { if (token === revision) { $('skybox-status').hidden=false; $('skybox-status').textContent=t('skyboxError'); } });
    }

    if (token !== revision) throw new DOMException('Superseded', 'AbortError');
    const viewer = runtime.viewer;
    viewer.damageEnabled = options.damage === true;
    await (viewer.locatorDamage ? viewer.locatorDamage.setEnabled(viewer.damageEnabled) : viewer.shipEffects?.setDamage?.(viewer.damageEnabled));
    if (token !== revision) throw new DOMException('Superseded', 'AbortError');
    const restoreFit=restored?.fit&&restored.fitKey===JSON.stringify([options.equipment,options.fitting]);
    if (
      restoreFit ||
      equipmentIds?.length ||
      options.fitting?.equipment?.length ||
      ((equipmentIds !== undefined || options.fitting !== undefined) && viewer.fitting) ||
      options.showHardpoints
    ) {
      loading.beginTask('loadingResources');
      await configureEquipment({
        viewer,
        item,
        options:restoreFit?{...options,fitting:{equipment:restored.fit}}:options,
        equipmentIds:restoreFit?undefined:equipmentIds,
        renderer,
        nativePreview: item.preview || index?.nativePreview,
        translate: t,
        isCurrent: () => token === revision,
      });
    }
    if (viewer.fitting) await fittingPanel.refreshFromViewer();
    if (options.hangar && supportsHangar(item)) await hangarPanel.configure(options.hangar);
    if (token !== revision) throw new DOMException('Superseded', 'AbortError');
    if(restored){
      const {orbit,target,fov}=restored;
      viewer.cameraTarget=`${target.x}m ${target.y}m ${target.z}m`;
      viewer.cameraOrbit=`${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
      viewer.fieldOfView=`${fov}deg`;viewer.jumpCameraToGoal();
    }
    loading.finish(true);
    runtime.applyDisplaySettings(settings.display);
    renderPanel();
    $('status').textContent = '';
    const result = {
      itemId: item.id,
      dna: item.dna,
      subsystems: item.subsystemSelection,
      dimensions: viewer.sourceDimensions,
      placements: placements(),
    };
    emit('load', result);
    return result;
  }

  return {
    frameIcon: options => frameIcon(runtime.viewer, options),
    renderIcon: options => renderIcon(runtime.viewer, {
      backgroundProfile: currentItem.categoryID === 3 ? 'station' : 'ship', ...options,
    }),
    async setIconScene(catalog) {
      const profile = currentItem.categoryID === 3 ? 'station' : 'ship';
      const {entry, provenance} = selectIconScene(catalog, currentItem.dna, profile);
      await this.setIconBackground({scenes:catalog.scenes, defaults:{}}, entry.id, entry.lighting);
      const viewer = runtime.viewer, context = viewer.nativeMaterialContext;
      const actual = context?.reflection.source;
      if (viewer.skybox.exportSource?.entry.id !== entry.id ||
          actual?.reflection !== entry.lighting.environment.source.reflection ||
          actual?.diffuse !== entry.lighting.environment.source.diffuse)
        throw Error('Installed icon scene resources do not match selection');
      const lights = context.lightRig.children.filter(light => light.isLight);
      if (lights.length !== 1 || !lights[0].isDirectionalLight || lights[0].intensity !== 1)
        throw Error('Unexpected icon light rig');
      const direction = lights[0].position.clone().sub(lights[0].target.position).normalize().toArray();
      const sourceDirection = entry.lighting.sunDirection;
      if (direction.some((value, i) => Math.abs(value + sourceDirection[i]/Math.hypot(...sourceDirection)) > 1e-6))
        throw Error('Installed icon sun direction does not match source scene');
      return {...provenance, installed:{background:viewer.skybox.exportSource.entry.url,
        reflection:actual.reflection, diffuse:actual.diffuse, sunDirection:direction,
        sunColor:context.reflection.settings.sunColor, lightCount:lights.length}};
    },
    async setIconBackground(catalog, id, lighting) {
      const viewer = runtime.viewer;
      if (backgroundTask) await backgroundTask;
      viewer.lifecycle.release('skybox');
      viewer.lifecycle.set('skybox', renderer.createSkybox(viewer, catalog, viewer.previewRace));
      await viewer.skybox.select(id);
      if (lighting) {
        viewer.lifecycle.release('shipEffects');
        viewer.lifecycle.release('disposeNative');
        const dispose = await renderer.installNativePreview(viewer, lighting, currentItem.model,
          currentItem.nativeTypeID || currentItem.id, currentItem.dna);
        viewer.lifecycle.set('disposeNative', dispose);
        if (currentItem.effects && !viewer.equipmentPreview) {
          const effects = currentItem.subsystemParts
            ? await renderer.installSubsystemParts(viewer, currentItem, lighting)
            : await renderer.installShipEffects(viewer, currentItem.effects, 'cruise', {typeID:currentItem.id});
          viewer.lifecycle.set('shipEffects', effects);
        }
      }
    },
    showPerformance: () => performancePanel.open(),
    configure,
    get readyForHangar() { return !!loadedItem && supportsHangar(currentItem); },
    async configureHangar(hangar) {
      const item = currentItem, viewer = runtime.viewer;
      await hangarPanel.configure(hangar);
      if (currentItem !== item || runtime.viewer !== viewer)
        throw new DOMException('Superseded', 'AbortError');
      return {itemId:item.id, subsystems:item.subsystemSelection, dimensions:viewer.sourceDimensions, placements:placements()};
    },
    placements,
    setLanguage,
    clearPanelRender(overrides) {
      if (overrides === null) panelRender = {};
      else for (const key of Object.keys(overrides)) delete panelRender[key];
    },
    cancel() {
      ++revision;
      requests.abort();
      loadedItem = null;
      runtime.cancel();
      fittingPanel.reset();
      hangarPanel.reset();
      loading.finish(true);
    },
    clear() {
      powerRestore=null;
      runtime.close();
      options.hangar = undefined;
      hangarPanel.reset();
      hangarPanel.resetResources();
      controls.sync();
      loadedItem = null;
      currentItem = null;
      $('stage-title').textContent = '';
      $('stage-subtitle').hidden = true;
    },
    getHangars: () => hangarPanel.getOptions(),
    get capabilities() {
      return {
        exportModel: runtime.canExport,
        exportSkybox: runtime.canExportSkybox,
        hangar: supportsHangar(currentItem),
      };
    },
    async getAvailableEquipment(slot) {
      await fittingPanel.ensure();
      if (runtime.viewer) fittingData = await runtime.viewer.assetSession.json('data/fitting.json');
      return (fittingData?.equipment || [])
        .filter((item) => runtime.viewer?.fitting?.canFit(slot, item))
        .map(({ id, name }) => ({ id, name }));
    },
    exportModel: (format) => runtime.exportModel(format),
    exportSkybox: () => runtime.exportSkybox(),
    resetView: reset,
    dispose() {
      performancePanel.dispose();
      releasePower();
      ++revision;
      requests.abort();
      runtime.close();
      loading.dispose();
    },
    showError(error) {
      loading.finish(true);
      $('status').textContent = error.message || t('modelFailed');
      $('retry').hidden = false;
      actions.sync();
    },
  };
}
