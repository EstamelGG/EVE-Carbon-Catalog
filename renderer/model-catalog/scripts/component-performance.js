export function createPerformancePanel(root, { runtime, renderer, translate: t, context }) {
  const doc = root.ownerDocument;
  const dialog = doc.createElement('dialog');
  dialog.className = 'performance-dialog';
  dialog.setAttribute('aria-labelledby', 'performance-title');
  dialog.innerHTML = `<header><h2 id="performance-title"></h2><button type="button" class="performance-copy"></button><button type="button" class="performance-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header><div class="performance-sections"></div>`;
  root.append(dialog);
  let observer,
    viewer,
    timer,
    report,
    opener,
    feedbackTimer,
    copyState = 'copyPerformance',
    copying = false,
    generation = 0;
  const copy = dialog.querySelector('.performance-copy');
  const number = (n, suffix = '') =>
    n == null ? '—' : `${Number(n.toFixed(2)).toLocaleString()}${suffix}`;
  function update() {
    if (viewer !== runtime.viewer) {
      observer?.dispose();
      viewer = runtime.viewer;
      observer = viewer ? renderer.watchViewerPerformance(viewer) : null;
    }
    dialog.querySelector('h2').textContent = t('performance');
    copy.textContent = t(copyState);
    dialog.querySelector('.performance-close').setAttribute('aria-label', t('closePerformance'));
    report = observer
      ? { capturedAt: new Date().toISOString(), ...context(), ...observer.snapshot() }
      : { capturedAt: new Date().toISOString(), ...context(), status: t('performanceNoScene') };
    copy.disabled = !observer || copying;
    const frame = report.frame,
      resources = report.resources;
    const sections = dialog.querySelector('.performance-sections');
    sections.replaceChildren();
    const values = frame
      ? [
          ['FPS (2s)', number(frame.fps)],
          [t('performanceCPU'), number(frame.averageCpuSubmitMs, ' ms')],
          [t('performanceDraws'), number(frame.averageDrawCalls)],
          [t('performanceTriangles'), number(frame.averageTriangles)],
          [t('performanceObjects'), `${resources.objects} / ${resources.visibleObjects}`],
          [
            t('performanceCounts'),
            `${resources.geometries} / ${resources.materials} / ${resources.textures}`,
          ],
          [t('performanceGeometry'), number(resources.geometryBytes / 1048576, ' MiB')],
          [t('performanceTextures'), number(resources.estimatedTextureBytes / 1048576, ' MiB')],
          [
            t('performanceGPU'),
            `${report.gpuMemory.geometries} / ${report.gpuMemory.textures} / ${report.programs}`,
          ],
          [t('performanceCanvas'), `${report.canvas.width} × ${report.canvas.height}`],
        ]
      : [[t('performanceNoScene'), '—']];
    const onOff = (value) => (value == null ? '—' : t(value ? 'diagnosticOn' : 'diagnosticOff'));
    const { item, scene, configuration: config } = report;
    const hangar = scene.hangar;
    const vector = (v) => (v ? [v.x, v.y, v.z].map((n) => number(n)).join(' / ') : '—');
    const sectionsData = [
      ['diagnosticPerformance', values],
      [
        'diagnosticScene',
        [
          [t('diagnosticItem'), item ? `${item.name} · ${item.id}` : '—'],
          ['DNA', item?.dna || '—'],
          [t('diagnosticDimensions'), item?.dimensions ? vector(item.dimensions) + ' m' : '—'],
          [
            t('diagnosticBackground'),
            `${scene.background.label || scene.background.requested} (${scene.background.requested})`,
          ],
          [
            t('diagnosticActiveBackground'),
            scene.background.active?.id || scene.background.active?.label || t('skyboxNone'),
          ],
          [t('diagnosticHangar'), onOff(hangar.active)],
          [
            t('hangarRoom'),
            hangar.active
              ? `${hangar.roomLabel || hangar.selection?.room} (${hangar.selection?.room})`
              : '—',
          ],
          [
            t('hangarMode'),
            hangar.active
              ? hangar.selection?.mode === 'interior'
                ? t('hangarInterior')
                : t('hangarDock')
              : '—',
          ],
          [
            t('hangarShip'),
            hangar.active
              ? hangar.selection?.ship
                ? `${hangar.shipLabel || ''} · ${hangar.selection.ship}`
                : item?.name || '—'
              : '—',
          ],
          [
            t('diagnosticEquipment'),
            scene.equipment.length
              ? scene.equipment
                  .map((p) => `${p.slot}: ${p.itemId} × ${p.mounts.length}`)
                  .join(' · ')
              : '—',
          ],
          [
            t('subsystemTitle'),
            scene.subsystems.parts.length
              ? scene.subsystems.parts.map((p) => p.name || p.id).join(' · ')
              : scene.subsystems.selection || '—',
          ],
          [
            t('animation'),
            `${scene.animation.name || '—'}${scene.animation.paused === true ? ' · ' + t('paused') : ''}`,
          ],
          [
            t('diagnosticCamera'),
            scene.camera.orbit
              ? `${number(scene.camera.orbit.radius)} / FOV ${number(scene.camera.fieldOfView)}°`
              : '—',
          ],
          [t('diagnosticTarget'), vector(scene.camera.target)],
        ],
      ],
      [
        'diagnosticConfiguration',
        [
          [t('showAntialias'), config.display.antialiasMode || '—'],
          [
            t('diagnosticActualAA'),
            config.postprocessing
              ? `MSAA ${config.postprocessing.msaa}× / SMAA ${onOff(config.postprocessing.smaa)}`
              : '—',
          ],
          ...[
            ['effects', 'showEffects'],
            ['occlusion', 'showOcclusion'],
            ['bloom', 'showBloom'],
            ['depthOfField', 'showDepthOfField'],
            ['noColor', 'noColor'],
          ].map(([key, label]) => [t(label), onOff(config.display[key])]),
          ...[
            ['exposure', 'brightness'],
            ['reflection', 'reflection'],
            ['bloom', 'bloom'],
            ['sun', 'sun'],
            ['fill', 'fill'],
            ['f0', 'f0'],
            ['roughness', 'roughness'],
            ['dirt', 'dirtStrength'],
            ['depthOfField', 'depthOfField'],
          ].map(([key, label]) => [t(label), number(config.render[key])]),
          [t('rotate'), onOff(config.autoRotate)],
          [t('invertWheel'), onOff(config.invertWheel)],
          [t('killCount'), number(config.killCount)],
          [
            t('diagnosticDisabledTextures'),
            Object.entries(config.display.textures || {})
              .filter(([, enabled]) => !enabled)
              .map(([role]) => role)
              .join(' · ') || t('diagnosticNone'),
          ],
        ],
      ],
      [
        'diagnosticDevice',
        [
          ['GPU', report.gpu || '—'],
          [t('gpuPreference'), config.powerPreference],
          ['WebGL', report.device?.webglVersion || '—'],
          ['DPR', number(report.device?.devicePixelRatio)],
          [
            t('diagnosticRenderState'),
            !frame
              ? '—'
              : report.contextLost
                ? t('diagnosticContextLost')
                : report.paused
                  ? t('paused')
                  : t('diagnosticActive'),
          ],
          [
            t('diagnosticBudget'),
            config.postprocessingBudget
              ? Object.entries(config.postprocessingBudget)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(' · ')
              : '—',
          ],
          [t('diagnosticHeap'), report.jsHeap ? number(report.jsHeap.used / 1048576, ' MiB') : '—'],
        ],
      ],
    ];
    for (const [title, rows] of sectionsData) {
      const section = doc.createElement('section'),
        heading = doc.createElement('h3'),
        list = doc.createElement('dl');
      heading.textContent = t(title);
      list.className = 'performance-summary';
      for (const [label, value] of rows) {
        const cell = doc.createElement('div'),
          caption = doc.createElement('dt'),
          detail = doc.createElement('dd');
        caption.textContent = label;
        detail.textContent = value;
        cell.append(caption, detail);
        list.append(cell);
      }
      section.append(heading, list);
      sections.append(section);
    }
  }

  function close() {
    generation++;
    clearTimeout(feedbackTimer);
    clearInterval(timer);
    timer = null;
    observer?.dispose();
    observer = null;
    viewer = null;
    opener?.focus();
  }
  dialog.addEventListener('close', close);
  dialog.querySelector('.performance-close').onclick = () => dialog.close();
  copy.setAttribute('aria-live', 'polite');
  copy.onclick = async () => {
    if (copying) return;
    update();
    const text = JSON.stringify(report, null, 2),
      attempt = generation;
    copying = true;
    copy.disabled = true;
    clearTimeout(feedbackTimer);
    let success = false;
    try {
      if (!doc.defaultView.navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await doc.defaultView.navigator.clipboard.writeText(text);
      success = true;
    } catch {
      if (attempt !== generation || !dialog.open) return;
      // Clipboard API fallback for HTTP and older browsers; no visible report UI.
      const area = doc.createElement('textarea');
      area.value = text;
      area.className = 'performance-clipboard';
      area.setAttribute('aria-hidden', 'true');
      dialog.append(area);
      area.select();
      try {
        success = doc.execCommand('copy');
      } catch {
        /* Reflect failure on the button. */
      }
      area.remove();
      copy.focus();
    }
    if (attempt !== generation || !dialog.open) return;
    copying = false;
    copyState = success ? 'performanceCopied' : 'performanceCopyFailed';
    copy.textContent = t(copyState);
    copy.disabled = !observer;
    feedbackTimer = setTimeout(() => {
      copyState = 'copyPerformance';
      copy.textContent = t(copyState);
    }, 2000);
  };
  return {
    open() {
      if (dialog.open) return;
      opener = doc.activeElement;
      copyState = 'copyPerformance';
      copying = false;
      dialog.showModal();
      update();
      timer = setInterval(update, 1000);
    },
    dispose() {
      if (dialog.open) dialog.close();
      close();
      dialog.remove();
    },
  };
}
