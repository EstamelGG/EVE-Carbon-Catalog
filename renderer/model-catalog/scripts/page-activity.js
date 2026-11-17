const pages = new WeakMap();

// One foreground clock shared by rendering, effects and video playback.
export function pageActivity(doc = document) {
  if (pages.has(doc)) return pages.get(doc);
  const win = doc.defaultView,
    listeners = new Set();
  let active = false,
    elapsed = 0,
    started = 0;
  function readTime() {
    const value = win.performance.now();
    return Number.isFinite(value) ? value : started;
  }
  started = readTime();
  const now = () => {
    const base = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const value = active ? base + Math.max(0, readTime() - started) : base;
    return Number.isFinite(value) ? value : base;
  };
  function update() {
    const next = doc.visibilityState !== 'hidden' && doc.hasFocus();
    if (next === active) return;
    elapsed = now();
    started = readTime();
    active = next;
    for (const listener of listeners) listener(active);
  }
  const state = {
    get active() {
      return active;
    },
    now,
    subscribe(listener) {
      if (!listeners.size) {
        win.addEventListener('focus', update);
        win.addEventListener('blur', update);
        doc.addEventListener('visibilitychange', update);
        update();
      }
      listeners.add(listener);
      listener(active);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          elapsed = now();
          active = false;
          win.removeEventListener('focus', update);
          win.removeEventListener('blur', update);
          doc.removeEventListener('visibilitychange', update);
        }
      };
    },
  };
  pages.set(doc, state);
  return state;
}

export function pageAnimationLoop(callback, doc = document) {
  const activity = pageActivity(doc),
    win = doc.defaultView;
  let frame = null,
    unsubscribe,
    running = false;
  function schedule(active) {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = active && running ? win.requestAnimationFrame(tick) : null;
  }
  function tick() {
    frame = null;
    if (!running || !activity.active) return;
    if (callback(activity.now()) === false) stop();
    else schedule(activity.active);
  }
  function stop() {
    running = false;
    schedule(false);
    unsubscribe?.();
    unsubscribe = undefined;
  }
  return {
    now: activity.now,
    stop,
    start() {
      if (running) return;
      running = true;
      unsubscribe = activity.subscribe(schedule);
    },
  };
}

// Ambient effects share one sampling time per scene. Geometry, settings and
// camera controls continue to request their own renders immediately.
const ambientClocks = new WeakMap();
export function ambientAnimationLoop(scene, callback, doc = scene.element.ownerDocument) {
  const activity = pageActivity(doc);
  let clock;
  return {
    now: activity.now,
    start() {
      if (clock) return;
      clock = ambientClocks.get(scene);
      if (!clock) {
        clock = createAmbientClock(scene, doc);
        ambientClocks.set(scene, clock);
      }
      clock.callbacks.add(callback);
      clock.loop.start();
    },
    stop() {
      if (!clock) return;
      clock.callbacks.delete(callback);
      if (!clock.callbacks.size) {
        clock.loop.stop();
        ambientClocks.delete(scene);
      }
      clock = null;
    },
  };
}

function createAmbientClock(scene, doc) {
  const callbacks = new Set();
  const loop = pageAnimationLoop(now => {
    if (!scene.element.modelIsVisible) return;
    for (const update of callbacks) update(now);
  }, doc);
  return {callbacks, loop};
}
