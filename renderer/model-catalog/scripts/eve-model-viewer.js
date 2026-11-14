import overlay from './viewer-overlay.html';
import icons from './viewer-icons.json';
import { createComponentController } from './component-controller.js';
export {observeRenderer} from './viewer-performance.js';
import styles from './eve-model-viewer.css';
import nativeStyles from './viewer-ui.css';
import regularFont from '../src/github-assets/fonts/evesansneue-regular.otf';
import boldFont from '../src/github-assets/fonts/evesansneue-bold.otf';
// Embed the original Latin glyphs too, under a name scoped to this component.
if (typeof FontFace !== 'undefined')
  for (const [weight, bytes] of [
    [400, regularFont],
    [700, boldFont],
  ]) {
    const font = new FontFace('EVE Model Viewer UI', bytes, {
      weight: String(weight),
      ascentOverride: '95%',
      descentOverride: '26%',
      lineGapOverride: '0%',
    });
    font
      .load()
      .then((face) => document.fonts.add(face))
      .catch(() => {});
  }
const attributes = [
  'item-id',
  'dna',
  'resource-base',
  'res-base',
  'background',
  'exposure',
  'reflection',
  'kill-count',
  'effects',
  'damage',
  'white-model',
  'auto-rotate',
  'control-panel',
  'antialias',
  'power-preference',
  'show-hardpoints',
  'lang',
  'equipment',
  'hangar',
  'subsystems',
];
const abort = () =>
  new DOMException('Viewer configuration superseded or disconnected', 'AbortError');

/** Standalone ESM entry: styles, renderer and dependencies are bundled together. */
export class EveModelViewer extends HTMLElement {
  static observedAttributes = attributes;
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._options = {};
    this._sequence = 0;
    this._queue = Promise.resolve();
  }
  connectedCallback() {
    if (this._controller) return;
    this.shadowRoot.innerHTML = `<style>${nativeStyles}\n${styles}</style><div class="layout"><main id="viewer-stage"><div id="mount"></div><canvas id="snapshot" hidden></canvas>${overlay}<div id="status" role="status"></div><button id="retry" class="reset-button" hidden data-i18n="retry">Retry</button><slot name="overlay"></slot><div class="footer"><div class="hint"><span data-i18n="gestures">Drag to orbit · Scroll to zoom · Right-drag to pan</span><span id="gpu"></span></div><button id="reset" class="icon-button" title="Reset view" aria-label="Reset view" data-i18n-title="reset" data-i18n-aria-label="reset">${icons.reset}</button><button id="fullscreen" class="icon-button" title="Fullscreen" aria-label="Fullscreen" data-i18n-title="fullscreen" data-i18n-aria-label="fullscreen">${icons.expand}</button><span id="fps">— FPS</span></div></main><aside id="panel" class="detail-info" hidden></aside></div>`;
    this._controller = createComponentController(this.shadowRoot, (type, value) => {
      if (type === 'settings-change') this._merge(value);
      if (type === 'load' && value.subsystems) this._options.subsystems = value.subsystems;
      this.dispatchEvent(new CustomEvent(type, { detail: value }));
    });
    this._options = { ...this._attributes(), ...this._options };
    this._languageChanged = () => {
      if (!this._options.language || this._options.language === 'auto')
        this._controller?.setLanguage('auto');
    };
    this._languageObserver = new MutationObserver(this._languageChanged);
    this._languageObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
    window.addEventListener('languagechange', this._languageChanged);
    this._controller.setLanguage(this._options.language);
    this._schedule();
  }
  disconnectedCallback() {
    this._languageObserver?.disconnect();
    window.removeEventListener('languagechange', this._languageChanged);
    ++this._sequence;
    this._controller?.dispose();
    this._controller = null;
    this._queue = Promise.resolve();
    this._options.hangar = undefined;
  }
  attributeChangedCallback(name) {
    const values = this._attributes();
    const keys = {
      'item-id': 'itemId',
      dna: 'dna',
      'resource-base': 'resourceBase',
      'res-base': 'resBase',
      background: 'background',
      'power-preference': 'powerPreference',
      'kill-count': 'killCount',
      effects: 'effects',
      damage: 'damage',
      'white-model': 'whiteModel',
      'auto-rotate': 'autoRotate',
      'control-panel': 'controlPanel',
      'show-hardpoints': 'showHardpoints',
      lang: 'language',
      equipment: 'equipment',
      hangar: 'hangar',
      subsystems: 'subsystems',
    };
    if (name === 'equipment') this._merge({ equipment: values.equipment ?? [] });
    else if (name === 'exposure' || name === 'reflection')
      this._merge({ render: { [name]: values.render[name] } });
    else if (name === 'antialias') this._merge({ display: values.display });
    else this._merge({ [keys[name]]: values[keys[name]] });
    if (this.isConnected && this._controller) {
      if (name === 'lang') this._controller.setLanguage(values.language);
      else if (name === 'hangar') this.setHangar(values.hangar).catch(error => this._report(error));
      else this._schedule();
    }
  }
  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => {
      if (!this._scheduled) return;
      this._scheduled = false;
      if (this.isConnected && this._controller && (this._options.itemId != null || this._options.dna))
        this.configure().catch((error) => this._report(error));
    });
  }
  _report(error) {
    if (error.name !== 'AbortError') {
      this._controller?.showError(error);
      this.dispatchEvent(
        new CustomEvent('error', { detail: { message: error.message || 'Model loading failed' } }),
      );
    }
  }
  _merge(options) {
    if (Object.hasOwn(options, 'fitting') && !Object.hasOwn(options, 'equipment'))
      this._options.equipment = undefined;
    this._options = {
      ...this._options,
      ...options,
      render: { ...this._options.render, ...options.render },
      display: { ...this._options.display, ...options.display },
    };
  }
  _attributes() {
    const value = (name) => this.getAttribute(name);
    return {
      hangar: value('hangar') === null ? undefined : { room: value('hangar') },
      subsystems: value('subsystems') || undefined,
      equipment: value('equipment') ?? undefined,
      language: value('lang') || 'auto',
      dna: value('dna')?.trim() || undefined,
      itemId: value('item-id') === null ? null : Number(value('item-id')),
      resourceBase: value('resource-base') || undefined,
      resBase: value('res-base') ?? undefined,
      powerPreference: value('power-preference') || undefined,
      background: value('background') || 'auto',
      killCount: Number(value('kill-count')) || 0,
      effects: value('effects') !== 'false',
      damage: value('damage') === 'true',
      whiteModel: this.hasAttribute('white-model'),
      autoRotate: this.hasAttribute('auto-rotate'),
      controlPanel: this.hasAttribute('control-panel'),
      showHardpoints: this.hasAttribute('show-hardpoints'),
      render: Object.fromEntries(
        ['exposure', 'reflection']
          .filter((k) => value(k) !== null)
          .map((k) => [k, Number(value(k))]),
      ),
      display: { antialiasMode: value('antialias') || 'auto' },
    };
  }
  configure(options = {}) {
    if (!this._scheduled && !this._configuring && this._controller?.readyForHangar &&
        Object.keys(options).length === 1 && Object.hasOwn(options, 'hangar')) {
      this._merge(options);
      return this._controller.configureHangar(options.hangar);
    }
    this._scheduled = false;
    this._merge(options);
    if (this._configuring) this._controller?.cancel();
    if (!this._controller)
      return Promise.reject(new DOMException('Viewer is not connected', 'InvalidStateError'));
    const snapshot = structuredClone(this._options),
      controller = this._controller,
      sequence = ++this._sequence;
    const task = this._queue
      .catch(() => {})
      .then(async () => {
        if (controller !== this._controller || sequence !== this._sequence) throw abort();
        this._configuring = true;
        try {
          return await controller.configure(snapshot);
        } catch (error) {
          if (error.name !== 'AbortError' && sequence === this._sequence)
            controller.showError(error);
          throw error;
        } finally {
          if (sequence === this._sequence) this._configuring = false;
        }
      });
    this._queue = task;
    return task;
  }
  cancel() {
    ++this._sequence;
    this._configuring = false;
    this._controller?.cancel();
  }
  clear() {
    this.cancel();
    this._options.hangar = undefined;
    this._controller?.clear();
  }
  showError(message) {
    this._controller?.showError(new Error(message));
  }
  get capabilities() {
    return (
      this._controller?.capabilities || { exportModel: false, exportSkybox: false, hangar: false }
    );
  }
  async getHangars() {
    await this._queue.catch(() => {});
    return this._controller?.getHangars() || [];
  }
  setHangar(hangar) {
    return this.configure({ hangar });
  }
  get placements() {
    return this._controller?.placements() || [];
  }
  async getPlacements() {
    await this._queue.catch(() => {});
    return this._controller?.placements() || [];
  }
  async getAvailableEquipment(slot) {
    await this._queue.catch(() => {});
    return this._controller?.getAvailableEquipment(slot) || [];
  }
  async exportModel(format = 'glb') {
    await this._queue.catch(() => {});
    if (!this._controller) throw abort();
    return this._controller.exportModel(format);
  }
  async exportSkybox() {
    await this._queue.catch(() => {});
    if (!this._controller) throw abort();
    return this._controller.exportSkybox();
  }
  showPerformance() {
    this._controller?.showPerformance();
  }
  resetView() {
    this._controller?.resetView();
  }
}
if (!customElements.get('eve-model-viewer'))
  customElements.define('eve-model-viewer', EveModelViewer);
