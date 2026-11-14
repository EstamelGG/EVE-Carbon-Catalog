// Each enable owns its pending installation. A late result never revives an
// effect that was disabled or belongs to a viewer that has already closed.
export function createDamageToggle(create, changed = () => {}) {
  let enabled = false, visible = true, disposed = false, session = null, pending = null, revision = 0;
  function notify() { changed({enabled, visible: enabled && visible, ready: !!session}); }
  return {
    get enabled() { return enabled; },
    setEnabled(value) {
      const next = value === true;
      if (disposed) return Promise.resolve();
      if (enabled === next) return pending || Promise.resolve();
      enabled = next;
      const token = ++revision;
      session?.dispose(); session = null;
      notify();
      if (!enabled) { pending = null; return Promise.resolve(); }
      pending = Promise.resolve().then(create).then(result => {
        if (disposed || revision !== token) { result.dispose(); return; }
        session = result;
        session.setVisible(visible);
        notify();
      }).catch(error => {
        if (disposed || revision !== token) return;
        enabled = false; notify(); throw error;
      }).finally(() => { if (revision === token) pending = null; });
      return pending;
    },
    setVisible(value) { visible = value !== false; session?.setVisible(visible); notify(); },
    dispose() {
      if (disposed) return;
      disposed = true; enabled = false; ++revision;
      session?.dispose(); session = null; pending = null; notify();
    },
  };
}
