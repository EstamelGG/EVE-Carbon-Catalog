const releasedScopes = ['hangar', 'shipEffects', 'fitting', 'disposeNative'];

function cleanupFailure(primary, actions) {
  const errors = [];
  for (const action of actions) {
    try { action(); } catch (error) { errors.push(error); }
  }
  return errors.length ? new AggregateError([primary, ...errors], 'Appearance update and cleanup failed', {cause: primary}) : primary;
}

// The request owns prepared resources until commit hands them to the viewer.
// A failed synchronous commit is cleaned up, then the caller must reload.
export async function prepareAppearanceTransaction(viewer, {item, document, source, settings}, request,
  {prepareNativePreview, installShipEffects}) {
  let native, effects, disposed = false, committed = false;
  let diagnostics = {};
  const context = new Proxy(viewer, {
    get(target, key) {
      if (key === 'appearanceDocument') return document;
      if (key === 'appearanceURL') return source;
      if (key === 'dataset') return diagnostics;
      const value = Reflect.get(target, key, target);
      // DOM and custom-element methods require the actual element as their receiver.
      return typeof value === 'function' && !Object.hasOwn(target,key) ? value.bind(target) : value;
    },
  });
  const update = request.own({
    dispose() {
      if (disposed) return;
      disposed = true;
      const pendingEffects = effects, pendingNative = native;
      effects = native = undefined;
      const errors = [];
      for (const resource of [pendingEffects, pendingNative]) {
        try { resource?.dispose(); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Appearance cleanup failed');
    },
    commit() {
      if (disposed || committed || !request.isCurrent()) return;
      try {
        for (const key of releasedScopes) viewer.lifecycle.release(key);
        viewer.lifecycle.set('disposeNative', native.commit());
        native = undefined;
        effects?.commit();
        viewer.lifecycle.set('shipEffects', effects);
        effects = undefined;
        viewer.appearanceDocument = document;
        viewer.appearanceURL = source;
        Object.assign(viewer.dataset, diagnostics);
        diagnostics = viewer.dataset;
        committed = true;
      } catch (error) {
        throw cleanupFailure(error, [
          ...releasedScopes.map(key => () => viewer.lifecycle.release(key)),
          () => update.dispose(),
        ]);
      }
    },
  });
  if (disposed || !request.isCurrent()) return update;
  try {
    native = await prepareNativePreview(viewer, settings, source, item.nativeTypeID || item.id,
      item.dna, {document});
    if (disposed || !request.isCurrent()) {
      // Cancellation can dispose the transaction before an awaited scope arrives.
      const late = native;
      native = undefined;
      late.dispose();
      update.dispose();
      return update;
    }
    if (item.effects) effects = await installShipEffects(context, item.effects, 'cruise', {deferred: true});
    if (disposed || !request.isCurrent()) {
      const late = effects;
      effects = undefined;
      try { late?.dispose(); } finally { update.dispose(); }
    }
    return update;
  } catch (error) {
    throw cleanupFailure(error, [() => update.dispose()]);
  }
}
