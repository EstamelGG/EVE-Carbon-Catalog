// Export UI consumes the same public capabilities as embedding applications.
export function bindViewerActions(root, { runtime, translate: t, name, reset, fullscreen, retry }) {
  const $ = (id) => root.getElementById(id);
  let busy = false,
    statusTimer;
  function showStatus(key, values, duration = 6000) {
    clearTimeout(statusTimer);
    const status = $('export-status');
    status.textContent = t(key, values);
    status.hidden = false;
    if (duration)
      statusTimer = setTimeout(() => {
        status.hidden = true;
        status.textContent = '';
      }, duration);
  }
  function sync() {
    for (const format of ['glb', 'obj'])
      $('export-' + format).disabled = busy || !runtime.canExport;
    $('export-skybox').disabled = busy || !runtime.canExportSkybox;
  }
  async function download(format) {
    if (busy) return;
    const item = runtime.readyItem;
    if (!item) return;
    clearTimeout(statusTimer);
    busy = true;
    sync();
    const status = $('export-status');
    status.hidden = false;
    status.textContent = t('exporting', { format: format.toUpperCase() });
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const result = format === 'hdr' ? runtime.exportSkybox() : await runtime.exportModel(format);
      const filename =
        format === 'hdr'
          ? result.name
          : `${item.id}-${name(item.name)}${item.subsystemSelection ? '-' + item.subsystemSelection : ''}.${format}`;
      const url = URL.createObjectURL(result.blob),
        link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showStatus(
        format === 'hdr'
          ? 'exportSkyboxDone'
          : format === 'glb'
            ? 'exportGlbDone'
            : 'exportObjDone',
        { count: result.skipped },
      );
    } catch (error) {
      showStatus('exportFailed');
      console.warn(error);
    } finally {
      busy = false;
      sync();
    }
  }
  for (const format of ['glb', 'obj']) $('export-' + format).onclick = () => download(format);
  $('export-skybox').onclick = () => download('hdr');
  $('reset').onclick = reset;
  $('reset-view').onclick = reset;
  $('fullscreen').onclick = fullscreen;
  $('retry').onclick = retry;
  return { sync };
}
