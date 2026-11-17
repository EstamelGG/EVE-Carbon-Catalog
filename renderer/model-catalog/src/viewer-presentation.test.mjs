import assert from 'node:assert/strict';
import test from 'node:test';
import {configureHullAnimations} from './viewer-presentation.mjs';

test('finished hull clips remain selected without switching to a destination', () => {
  const listeners = new Map();
  const options = [];
  const document = {
    createElement() {
      return {};
    },
  };
  const select = {
    disabled: false,
    value: '',
    replaceChildren(...nodes) {
      options.push(...nodes);
    },
  };
  const viewer = {
    availableAnimations: ['Hull.TriggerStart', 'Hull.TriggerLoop'],
    animationName: '',
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    const cleanup = configureHullAnimations(viewer, {
      row: {},
      select,
      translate: (name) => name,
      play: () => {},
      isActive: () => true,
    });

    assert.equal(select.value, 'Hull.TriggerStart');
    assert.equal(listeners.has('finished'), false);
    assert.equal(options.length, 2);
    cleanup();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
