// Defer the complete scene/camera resize, so postprocessing targets also keep
// their allocation during a drag. Window chrome has no DOM pointer-up event;
// a quiet interval handles native window resizing and other layout changes.
export function installDeferredResize(viewer, resizeKey, {delay = 200} = {}) {
  const win = viewer.ownerDocument.defaultView;
  const original = viewer[resizeKey], descriptor = Object.getOwnPropertyDescriptor(viewer, resizeKey);
  const pointers = new Set();
  let applied = null, pending = null, timer = null, frame = null, disposed = false;
  const valid = size => size.width > 0 && size.height > 0;
  const same = (a, b) => a && b && a.width === b.width && a.height === b.height;
  const mark = value => viewer.toggleAttribute('data-resize-pending', value);
  function cancel() {
    win.clearTimeout(timer); win.cancelAnimationFrame(frame);
    timer = frame = null;
  }
  function apply(size) {
    applied = {width:size.width, height:size.height};
    return original.call(viewer, applied);
  }
  function flush() {
    cancel();
    if (disposed || !pending) return;
    pending = null; mark(false);
    if (!viewer.isConnected) return;
    // Pointer-up can arrive before the final ResizeObserver delivery.
    // Computed content dimensions also avoid applying an ancestor's CSS
    // transform scale to the render allocation (unlike the screen rectangle).
    const style = win.getComputedStyle(viewer);
    const size = {width:parseFloat(style.width), height:parseFloat(style.height)};
    // model-viewer passes ResizeObserverEntry.contentRect to its resize hook.
    // CSS width/height include the border and padding under border-box sizing.
    if (style.boxSizing === 'border-box') {
      size.width -= parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      size.height -= parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    }
    if (valid(size) && !same(applied, size)) apply(size);
  }
  function resize(size) {
    if (disposed || !viewer.isConnected || !valid(size)) return;
    if (!applied) return apply(size); // Initial layout must not delay model loading.
    if (same(applied, size)) {
      cancel(); pending = null; mark(false); return;
    }
    if (same(pending, size)) return;
    pending = {width:size.width, height:size.height}; mark(true);
    cancel();
    if (!pointers.size) timer = win.setTimeout(flush, delay);
  }
  function down(event) {
    pointers.add(event.pointerId);
    cancel();
  }
  function released(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size && pending) {
      cancel(); frame = win.requestAnimationFrame(flush);
    }
  }
  function moved(event) {
    // Recover if the button was released outside this document.
    if (event.buttons === 0 && pointers.has(event.pointerId)) released(event);
  }
  function blurred() {
    pointers.clear();
    if (pending) { cancel(); frame = win.requestAnimationFrame(flush); }
  }
  const listeners = {pointerdown:down, pointerup:released, pointercancel:released, pointermove:moved, blur:blurred};
  for (const [name, handler] of Object.entries(listeners)) win.addEventListener(name, handler, true);
  viewer[resizeKey] = resize;
  return () => {
    if (disposed) return;
    disposed = true; cancel(); pending = null; pointers.clear(); mark(false);
    for (const [name, handler] of Object.entries(listeners)) win.removeEventListener(name, handler, true);
    if (viewer[resizeKey] === resize) {
      if (descriptor) Object.defineProperty(viewer, resizeKey, descriptor);
      else delete viewer[resizeKey];
    }
  };
}
