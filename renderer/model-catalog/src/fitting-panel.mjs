import { loadJSON } from './resource-activity.mjs';
import { resourceURL } from './resource-location.mjs';
import { loadFittingData } from './fitting-data.mjs';
import { uniqueEquipmentModels } from './fitting-directory.mjs';
import {
  equipmentSize,
  hardpointFamilies,
  hardpointSlotSize,
} from './hardpoint-locators.mjs';

export function fittingSlotLayout({
  width,
  count,
  size = 48,
  minGap = 8,
  maxGap = 24,
}) {
  const minColumns = Math.min(4, count);
  let columns = Math.min(8, count);
  while (columns > minColumns && (width - columns * size) / (columns - 1) < minGap)
    columns--;
  return {
    columns,
    gap:
      columns > 1
        ? Math.min(maxGap, Math.max(0, (width - columns * size) / (columns - 1)))
        : 0,
  };
}

export function fittingSupported(item) {
  return !!item?.fitting && item.groupID !== 963 && !item.subsystemParts;
}

export function createFittingPanel({
  root,
  currentViewer,
  currentItem,
  translate: t,
  name,
  groupName,
  nativeSettings,
  loading,
  readRecent = () => null,
  saveRecent = () => {},
  onAvailability = () => {},
  loadResource = (url) => loadJSON(resourceURL(url)),
}) {
  const $ = (id) => root.querySelector('#' + id),
    saved = new Map(),
    equipmentButtons = new Map();
  const slotsHost = $('fitting-slots'),
    stickyHost = $('fitting-controls');
  function layoutSlots() {
    const count = Number(slotsHost.dataset.count || 0),
      width = slotsHost.clientWidth;
    if (!count || !width) return;
    const styles = getComputedStyle(slotsHost),
      size = parseFloat(styles.getPropertyValue('--slot-size')) || 48,
      minGap = parseFloat(styles.getPropertyValue('--slot-min-gap')) || 8,
      maxGap = parseFloat(styles.getPropertyValue('--slot-max-gap')) || 24;
    const { columns, gap } = fittingSlotLayout({ width, count, size, minGap, maxGap });
    slotsHost.dataset.columns = String(columns);
    slotsHost.style.setProperty('--slot-columns', String(columns));
    slotsHost.style.setProperty('--slot-gap', `${gap.toFixed(2)}px`);
  }
  function syncStickySlotHeight() {
    const styles = getComputedStyle(slotsHost),
      height =
        slotsHost.getBoundingClientRect().height +
        (parseFloat(styles.marginTop) || 0) +
        (parseFloat(styles.marginBottom) || 0);
    stickyHost?.style.setProperty(
      '--fitting-slots-sticky-height',
      `${Math.ceil(height)}px`,
    );
  }
  const slotObserver = new ResizeObserver(() => {
    layoutSlots();
    requestAnimationFrame(syncStickySlotHeight);
  });
  slotObserver.observe(slotsHost);
  let active = false,
    context = null,
    generation = 0,
    pending = null,
    preloaded = new Map(),
    dataPromise = new Map(),
    data = null,
    operation = null,
    expandedGroups = new Set(),
    directoryQuery = '';
  let statusKey = 'fittingHint',
    statusValues;
  let lastEquipment = readRecent();
  const valid = (c) => context === c && currentViewer() === c.viewer && currentItem() === c.item;
  function state(id) {
    if (!saved.has(id))
      saved.set(id, {
        choices: new Map(),
        slot: null,
        targeted: false,
        deployed: true,
        undo: null,
      });
    return saved.get(id);
  }
  const busy = () => operation?.context === context;
  function status(key, values) {
    if (key !== undefined) {
      statusKey = key;
      statusValues = values;
    }
    const node = $('fitting-status');
    node.textContent = t(statusKey, statusValues);
    node.dataset.kind = statusKey;
  }
  function loadingTask(title) {
    const task = loading?.beginTask(title);
    task?.plan([]);
    task?.progress(2);
    return task;
  }
  function equipmentItem(id) {
    return data?.equipment.find((item) => item.id === Number(id));
  }
  function animateCategoryLabels(host) {
    const labels = [...host.querySelectorAll('.fitting-category-label')];
    requestAnimationFrame(() => {
      for (const label of labels) {
        const text = label.firstElementChild;
        if (!label.isConnected || !text) continue;
        const overflow = text.scrollWidth - label.clientWidth;
        if (overflow <= 1) continue;
        text.style.setProperty('--category-scroll-distance', `-${overflow + 4}px`);
        text.style.animationDuration = `${Math.max(2400, Math.min(6000, overflow * 48))}ms`;
        text.classList.add('is-scrolling');
      }
    });
  }
  function canFitSlot(slot, id) {
    const fitting = context?.viewer.fitting,
      item = equipmentItem(id);
    return !busy() && !!fitting && !!item && fitting.canFit(slot, item);
  }
  function hasCompatibleTarget(id) {
    const fitting = context?.viewer.fitting,
      item = equipmentItem(id);
    return (
      !!fitting &&
      !!item &&
      fitting.slots.some(
        (definition) =>
          definition.available !== false && fitting.canFit(definition.slot, item),
      )
    );
  }
  function autoSlot(id) {
    const fitting = context?.viewer.fitting,
      item = equipmentItem(id);
    if (!fitting || !item) return null;
    const available = fitting.slots.filter((definition) => definition.available !== false),
      ordered = [
        ...available.filter((definition) => !fitting.get(definition.slot)),
        ...available,
      ],
      unique = new Set();
    for (const definition of ordered) {
      if (unique.has(definition.slot)) continue;
      unique.add(definition.slot);
      if (fitting.canFit(definition.slot, item)) return definition.slot;
    }
    return null;
  }
  function viewerHardpoints(viewer) {
    return (
      (viewer?.appearanceDocument || viewer?.originalGltfJson)?.extras?.ccpdec
        ?.locators?.hardpoints || []
    );
  }
  async function mountData(viewer) {
    return loadData(viewerHardpoints(viewer));
  }
  function preloadKey(item) {
    return JSON.stringify([item?.fitting, item?.dna]);
  }
  function baseData(item) {
    const key = preloadKey(item);
    if (!preloaded.has(key))
      preloaded.set(
        key,
        loadFittingData(item, loadResource).catch((error) => {
          preloaded.delete(key);
          throw error;
        }),
      );
    return preloaded.get(key);
  }
  function loadData(hardpoints = []) {
    const item = currentItem(),
      families = hardpointFamilies(hardpoints),
      key = JSON.stringify([
        item?.fitting,
        item?.dna,
        families,
      ]);
    if (!dataPromise.has(key))
      dataPromise.set(
        key,
        baseData(item)
          .then((data) =>
            data.sourceVersion === 3 && families.length
              ? loadFittingData(item, loadResource, hardpoints)
              : data,
          )
          .catch((error) => {
            dataPromise.delete(key);
            throw error;
          }),
      );
    return dataPromise.get(key);
  }
  function totals() {
    const fitting = context?.viewer.fitting;
    if (busy()) status('fittingLoading');
    else if (fitting)
      status('fittingReady', { groups: fitting.slots.length, count: fitting.count });
  }
  function equipmentIcon(item, placeholder = '+') {
    const frame = document.createElement('span');
    frame.className = 'fitting-equipment-icon';
    frame.setAttribute('aria-hidden', 'true');
    if (item) {
      const image = document.createElement('img');
      image.src = `https://images.evetech.net/types/${item.id}/icon?size=64`;
      image.alt = '';
      image.width = 32;
      image.height = 32;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.onerror = () => {
        image.hidden = true;
      };
      frame.append(image);
    } else frame.textContent = placeholder;
    return frame;
  }
  function renderSlots() {
    const fitting = context?.viewer.fitting,
      host = $('fitting-slots');
    if (!fitting) {
      delete host.dataset.count;
      delete host.dataset.columns;
      host.style.removeProperty('--slot-columns');
      host.style.removeProperty('--slot-gap');
      host.replaceChildren();
      requestAnimationFrame(syncStickySlotHeight);
      return;
    }
    host.dataset.count = String(fitting.slots.length);
    const s = state(context.item.id);
    host.replaceChildren(
      ...fitting.slots.map((definition) => {
        const item = equipmentItem(fitting.get(definition.slot)?.id),
          count = fitting.activeMounts(definition.slot).length,
          number = String(definition.slot).padStart(2, '0'),
          size = hardpointSlotSize(definition, currentItem()),
          shell = document.createElement('div'),
          target = document.createElement('button'),
          numberNode = document.createElement('span'),
          sizeNode = document.createElement('span'),
          countNode = document.createElement('span');
        shell.className = 'fitting-slot-shell';
        target.type = 'button';
        target.className = 'fitting-slot-target';
        target.classList.toggle('is-empty', !item);
        target.classList.toggle('is-installed', !!item);
        target.disabled = busy() || definition.available === false;
        target.setAttribute('aria-current', String(s.slot === definition.slot));
        target.classList.toggle(
          'is-targeted',
          s.targeted && s.slot === definition.slot,
        );
        const description =
          t('fittingSlot', { slot: number, count }) +
          ' · ' +
          (item ? name(item.name) : t('fittingEmpty')) +
          (size ? ` · ${size.toUpperCase()}` : '');
        target.setAttribute('aria-label', description);
        target.title = description;
        numberNode.className = 'fitting-slot-number';
        numberNode.textContent = number;
        sizeNode.className = 'fitting-slot-size';
        sizeNode.textContent = size;
        countNode.className = 'fitting-slot-count';
        countNode.textContent = count > 1 ? `×${count}` : '';
        if (item) target.append(numberNode, sizeNode);
        else target.append(numberNode);
        target.append(equipmentIcon(item, size), countNode);
        target.addEventListener('click', () => {
          if (busy()) return;
          if (s.targeted && s.slot === definition.slot) s.targeted = false;
          else {
            s.slot = definition.slot;
            s.targeted = true;
          }
          fitting.previewSlot?.(s.targeted ? definition.slot : null);
          if (item) fitting.focusSlot?.(definition.slot);
          refreshRows();
        });
        target.addEventListener('pointerenter', () => {
          if (active) fitting.previewSlot?.(definition.slot);
        });
        target.addEventListener('pointerleave', () => fitting.previewSlot?.(null));
        shell.append(target);
        if (item) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'fitting-slot-remove';
          remove.textContent = '×';
          remove.title = t('fittingRemove');
          remove.setAttribute('aria-label', t('fittingRemove'));
          remove.disabled = busy();
          remove.addEventListener('click', () => {
            state(context.item.id).targeted = false;
            void applyEquipment(definition.slot, null);
          });
          shell.append(remove);
        }
        return shell;
      }),
    );
    requestAnimationFrame(layoutSlots);
  }
  function refreshRows() {
    const fitting = context?.viewer.fitting;
    if (!fitting) return;
    const s = state(context.item.id);
    $('fitting-target-label').textContent = s.targeted
      ? t('fittingTargetSlot', { slot: String(s.slot).padStart(2, '0') })
      : t('fittingTargetAuto');
    $('fitting-target-auto').hidden = !s.targeted;
    $('fitting-browser').classList.toggle('is-auto-target', !s.targeted);
    $('fitting-undo').disabled = busy() || !s.undo;
    $('fitting-clear-all').disabled =
      busy() || !fitting.slots.some(({ slot }) => fitting.get(slot));
    renderSlots();
    const installed = new Set(s.choices.values());
    for (const [id, button] of equipmentButtons) {
      button.disabled = busy() || !hasCompatibleTarget(id);
      button.setAttribute('aria-pressed', String(installed.has(id)));
    }
  }
  async function renderDirectory() {
    const categoriesHost = $('fitting-category'),
      empty = $('fitting-results-empty'),
      fitting = context?.viewer.fitting;
    equipmentButtons.clear();
    if (!fitting || !data) {
      categoriesHost.replaceChildren();
      empty.hidden = true;
      return;
    }
    const query = $('fitting-search').value.trim().toLowerCase(),
      matching = data.equipment
        .filter((item) =>
          fitting.supports ? fitting.supports(item) : hasCompatibleTarget(item.id),
        )
        .filter(
          (item) =>
            !query ||
            `${item.id} ${item.name?.zh} ${item.name?.en} ${name(item.name)}`
              .toLowerCase()
              .includes(query),
        )
        .sort((a, b) => a.id - b.id);
    let groups = new Map();
    for (const item of matching) {
      if (!groups.has(item.groupID)) groups.set(item.groupID, []);
      groups.get(item.groupID).push(item);
    }
    let groupEntries = [...groups.entries()];
    if (!query) {
      groupEntries = groupEntries.map(([groupID, items]) => [
        groupID,
        uniqueEquipmentModels(items),
      ]);
    }
    groupEntries.sort(([a], [b]) => Number(a) - Number(b));
    if (query !== directoryQuery) {
      if (query) {
        for (const [groupID] of groupEntries) expandedGroups.add(groupID);
      } else expandedGroups.clear();
      directoryQuery = query;
    }
    const s = state(context.item.id);
    const equipmentButton = (item) => {
      const button = document.createElement('button'),
        text = document.createElement('span'),
        sizeNode = document.createElement('span'),
        size = equipmentSize(item),
        id = document.createElement('small');
      button.type = 'button';
      button.dataset.item = String(item.id);
      text.className = 'fitting-equipment-name';
      text.textContent = name(item.name);
      id.textContent = item.id === lastEquipment ? t('fittingLastChoice') : `#${item.id}`;
      sizeNode.className = 'fitting-equipment-size';
      sizeNode.textContent = size;
      button.append(equipmentIcon(item), text);
      if (size) button.append(sizeNode);
      button.append(id);
      button.title = size ? `${name(item.name)} · ${size.toUpperCase()}` : name(item.name);
      button.addEventListener('click', () => {
        if (busy()) return;
        const target = s.targeted
          ? canFitSlot(s.slot, item.id)
            ? s.slot
            : null
          : autoSlot(item.id);
        if (target == null) {
          status(s.targeted ? 'fittingNoCompatible' : 'fittingNoFreeMount');
          return;
        }
        s.targeted = false;
        void applyEquipment(target, item.id);
      });
      equipmentButtons.set(item.id, button);
      return button;
    };
    const groupSection = (groupID, items, label) => {
      const section = document.createElement('section'),
        button = document.createElement('button'),
        labelNode = document.createElement('span'),
        labelText = document.createElement('span'),
        countNode = document.createElement('small'),
        chevron = document.createElement('span'),
        itemHost = document.createElement('div'),
        expanded = expandedGroups.has(groupID),
        count = items.length,
        firstItem = items[0];
      section.className = 'fitting-category-group';
      button.type = 'button';
      button.className = 'fitting-category-chip';
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${label} (${count})`);
      button.title = label;
      labelNode.className = 'fitting-category-label';
      labelText.className = 'fitting-category-label-text';
      labelText.textContent = label;
      labelNode.append(labelText);
      countNode.textContent = String(count);
      chevron.className = 'fitting-category-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      itemHost.className = 'fitting-results fitting-category-items';
      itemHost.id = `fitting-group-${groupID}`;
      itemHost.hidden = !expanded;
      itemHost.replaceChildren(...items.map(equipmentButton));
      button.setAttribute('aria-controls', itemHost.id);
      button.append(equipmentIcon(firstItem), labelNode, countNode, chevron);
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        itemHost.hidden = !open;
        if (open) expandedGroups.add(groupID);
        else expandedGroups.delete(groupID);
      });
      section.append(button, itemHost);
      return section;
    };
    categoriesHost.replaceChildren(
      ...groupEntries.map(([groupID, items]) =>
        groupSection(groupID, items, groupName(groupID)),
      ),
    );
    animateCategoryLabels(categoriesHost);
    empty.hidden = groupEntries.length > 0;
    refreshRows();
  }
  async function change(c, slot, id) {
    if (!valid(c)) return false;
    const fitting = c.viewer.fitting,
      s = state(c.item.id);
    s.choices.set(slot, id);
    try {
      const changed = await fitting.set(slot, id);
      if (changed === false && valid(c) && s.choices.get(slot) === id)
        s.choices.set(slot, fitting.get(slot)?.id ?? null);
      return changed;
    } catch (error) {
      if (valid(c) && s.choices.get(slot) === id)
        s.choices.set(slot, fitting.get(slot)?.id ?? null);
      throw error;
    }
  }
  async function applyEquipment(slot, id, undo = false) {
    const c = context;
    if (!c || busy() || slot == null) return;
    const s = state(c.item.id),
      previous = c.viewer.fitting.get(slot)?.id ?? null;
    s.targeted = false;
    c.viewer.fitting.previewSlot?.(null);
    s.slot = slot;
    const current = { context: c };
    operation = current;
    refreshRows();
    status('fittingLoading');
    const task = id == null ? null : loadingTask('fittingLoading');
    let changed, error;
    try {
      changed = await change(c, slot, id);
    } catch (reason) {
      error = reason;
    } finally {
      task?.finish();
      if (operation === current) operation = null;
    }
    if (!valid(c)) return;
    if (changed !== false && !error) {
      if (undo) s.undo = null;
      else if (previous !== id) s.undo = { slot, id: previous };
      if (!undo && id != null) {
        lastEquipment = id;
        saveRecent(id);
      }
    }
    refreshRows();
    if (error) {
      status('fittingFailed');
      console.warn(error);
    } else totals();
  }
  async function replaceEquipment(choices, undo = false) {
    const c = context;
    if (!c?.viewer.fitting || busy()) return;
    const fitting = c.viewer.fitting,
      s = state(c.item.id);
    const previous = new Map(
      fitting.slots.flatMap(({ slot }) =>
        fitting.get(slot) ? [[slot, fitting.get(slot).id]] : [],
      ),
    );
    if (!undo && !previous.size) return;
    s.targeted = false;
    fitting.previewSlot?.(null);
    const current = { context: c };
    operation = current;
    refreshRows();
    status('fittingLoading');
    const task = choices.size ? loadingTask('fittingLoading') : null;
    let changed, error;
    try {
      changed = await fitting.replace(choices);
    } catch (reason) {
      error = reason;
    } finally {
      task?.finish();
      if (operation === current) operation = null;
    }
    if (!valid(c)) return;
    if (changed !== false && !error) {
      s.choices = new Map(choices);
      s.undo = undo ? null : { choices: previous };
    }
    refreshRows();
    if (error) {
      status('fittingFailed');
      console.warn(error);
    } else totals();
  }
  function render() {
    context?.viewer.fitting?.previewSlot?.(null);
    equipmentButtons.clear();
    const fitting = context?.viewer.fitting;
    $('fitting-slots').replaceChildren();
    $('fitting-category').replaceChildren();
    $('fitting-controls').hidden = !fitting;
    if (!fitting) {
      status();
      return;
    }
    const s = state(context.item.id);
    $('fitting-deployed').checked = s.deployed;
    if (!fitting.slots.some((definition) => definition.slot === s.slot)) {
      s.slot = fitting.slots.find((definition) => definition.available !== false)?.slot ?? null;
      s.targeted = false;
    }
    refreshRows();
    void renderDirectory();
    totals();
  }
  async function ensure() {
    const c = context;
    if (!c) {
      if (active) status('fittingWaitingModel');
      return;
    }
    if (!valid(c)) return;
    if (c.viewer.fitting) {
      c.viewer.fitting.setEditing(active);
      onAvailability(!!c.viewer.fitting.slots.length);
      return;
    }
    if (pending) return pending;
    if (!fittingSupported(c.item)) {
      status('fittingUnavailable');
      onAvailability(false);
      return;
    }
    status('fittingLoadingHardpoints');
    const token = generation,
      task = loadingTask('fittingLoadingHardpoints');
    const job = (async () => {
      try {
        data = await mountData(c.viewer);
        if (!valid(c) || token !== generation) return;
        const locators = viewerHardpoints(c.viewer);
        if (data.version !== 2 || !locators?.length) {
          status('fittingUnavailable');
          onAvailability(false);
          return;
        }
        const settings = await nativeSettings(c.viewer);
        if (!valid(c) || token !== generation) return;
        const fitting = c.module.installFitting(c.viewer, {
          locators,
          slots: data.slots,
          equipment: data.equipment,
          settings,
          appearance: data.appearance,
          dna: c.item.dna,
          hullCategory: data.hullCategory ?? c.item.categoryID,
        });
        c.viewer.lifecycle.set('fitting', fitting);
        onAvailability(!!fitting.slots.length);
        fitting.setEditing(active);
        const s = state(c.item.id);
        fitting.setDeployed(s.deployed);
        const restore = [...s.choices].filter(
            ([slot, id]) => id != null && fitting.slots.some((item) => item.slot === slot),
          ),
          restoring = { context: c };
        if (restore.length) operation = restoring;
        render();
        let restored;
        try {
          restored = await Promise.allSettled(
            restore.map(([slot, id]) => change(c, slot, id)),
          );
        } finally {
          if (operation === restoring) operation = null;
        }
        if (!valid(c)) return;
        refreshRows();
        const failed = restored.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        totals();
      } catch (error) {
        if (valid(c) && token === generation) {
          status('fittingFailed');
          onAvailability(false);
          console.warn('Fitting metadata failed', error);
        }
      } finally {
        task?.finish();
      }
    })();
    pending = job;
    try {
      await job;
    } finally {
      if (pending === job) pending = null;
    }
  }
  $('fitting-search').addEventListener('input', () => {
    void renderDirectory();
  });
  $('fitting-target-auto').addEventListener('click', () => {
    if (!context?.viewer.fitting) return;
    const s = state(context.item.id);
    s.targeted = false;
    context.viewer.fitting.previewSlot?.(null);
    refreshRows();
  });
  $('fitting-deployed').addEventListener('change', () => {
    if (context?.viewer.fitting) {
      state(context.item.id).deployed = $('fitting-deployed').checked;
      context.viewer.fitting.setDeployed($('fitting-deployed').checked);
    }
  });
  $('fitting-clear-all').addEventListener('click', () => void replaceEquipment(new Map()));
  $('fitting-undo').addEventListener('click', () => {
    const undo = context && state(context.item.id).undo;
    if (undo) {
      if (undo.choices) void replaceEquipment(undo.choices, true);
      else void applyEquipment(undo.slot, undo.id, true);
    }
  });
  return {
    setRecent(id) {
      if (Number.isSafeInteger(id) && id > 0) lastEquipment = id;
    },
    ensure,
    resetResources() {
      dataPromise.clear();
      preloaded.clear();
      data = null;
      saved.clear();
      lastEquipment = null;
      expandedGroups.clear();
      directoryQuery = '';
    },
    async refreshFromViewer() {
      const c = context;
      if (!c?.viewer.fitting) return;
      data = await mountData(c.viewer);
      if (!valid(c)) return;
      const fitting = c.viewer.fitting;
      state(c.item.id).choices = new Map(
        fitting.slots.flatMap(({ slot }) =>
          fitting.get(slot) ? [[slot, fitting.get(slot).id]] : [],
        ),
      );
      render();
    },
    // A failed background request must not block startup; opening Fitting retries.
    preload(item = currentItem()) {
      if (!fittingSupported(item)) return Promise.resolve(false);
      return baseData(item).then(
        () => true,
        () => false,
      );
    },
    connect(viewer, item, module) {
      generation++;
      pending = null;
      equipmentButtons.clear();
      viewer.lifecycle.release('fitting');
      context = { viewer, item, module };
      expandedGroups.clear();
      directoryQuery = '';
      $('fitting-controls').hidden = true;
      $('fitting-slots').replaceChildren();
      $('fitting-category').replaceChildren();
      status('fittingHint');
      void ensure();
    },
    reset() {
      context?.viewer.fitting?.previewSlot?.(null);
      generation++;
      pending = null;
      equipmentButtons.clear();
      context?.viewer.fitting?.setEditing(false);
      context = null;
      $('fitting-controls').hidden = true;
      $('fitting-slots').replaceChildren();
      $('fitting-category').replaceChildren();
      status(active ? 'fittingWaitingModel' : 'fittingHint');
    },
    setActive(value) {
      active = value;
      $('panel')?.classList.toggle('is-fitting-active', active);
      if (!active) context?.viewer.fitting?.previewSlot?.(null);
      context?.viewer.fitting?.setEditing(active);
      if (active) void ensure();
    },
    render,
  };
}
