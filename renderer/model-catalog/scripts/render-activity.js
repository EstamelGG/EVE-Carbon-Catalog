import { pageActivity } from './page-activity.js';

export function installPauseTitle(doc, activity) {
  let prefix = '';
  function update() {
    const title =
      prefix && doc.title.startsWith(prefix) ? doc.title.slice(prefix.length) : doc.title;
    prefix = activity.active
      ? ''
      : doc.documentElement.lang.toLowerCase().startsWith('zh')
        ? '[暂停] '
        : '[Pause] ';
    if (doc.title !== prefix + title) doc.title = prefix + title;
  }
  const observer = new doc.defaultView.MutationObserver(update);
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const unsubscribe = activity.subscribe(update);
  return () => {
    unsubscribe();
    observer.disconnect();
    if (prefix && doc.title.startsWith(prefix)) doc.title = doc.title.slice(prefix.length);
  };
}

const renderers = new WeakMap();
export function installRenderActivity(viewer, renderer) {
  const doc = viewer.ownerDocument,
    activity = pageActivity(doc);
  let shared = renderers.get(renderer);
  if (!shared) {
    const native = renderer.threeRenderer,
      setLoop = native.setAnimationLoop;
    let requested = renderer.scenes.size ? (time, frame) => renderer.render(time, frame) : null;
    native.setAnimationLoop = function (callback) {
      requested = callback;
      setLoop.call(native, activity.active ? callback : null);
    };
    const unsubscribe = activity.subscribe((active) => {
      renderer.lastTick = doc.defaultView.performance.now();
      if (active) for (const scene of renderer.scenes) scene.queueRender();
      setLoop.call(native, active ? requested : null);
    });
    const restoreTitle = installPauseTitle(doc, activity);
    shared = {
      count: 0,
      dispose() {
        unsubscribe();
        restoreTitle();
        native.setAnimationLoop = setLoop;
        setLoop.call(native, requested);
        renderers.delete(renderer);
      },
    };
    renderers.set(renderer, shared);
  }
  shared.count++;
  const unsubscribe = activity.subscribe((active) => {
    viewer.renderPaused = !active;
    viewer.lifecycle.setSuspended(!active);
    viewer.dispatchEvent(
      new doc.defaultView.CustomEvent('render-activity-change', { detail: { paused: !active } }),
    );
  });
  return () => {
    unsubscribe();
    if (--shared.count === 0) shared.dispose();
  };
}
