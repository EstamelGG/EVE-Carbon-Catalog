// Keep results in source order. Drain active work before rejecting so owners
// can dispose safely without late workers attaching new scene resources.
export async function concurrentMap(items, load, {limit = 4, isValid = () => true} = {}) {
  const values = Array.from(items), results = new Array(values.length);
  let cursor = 0, failed = false, failure;
  async function worker() {
    while (!failed && isValid() && cursor < values.length) {
      const index = cursor++;
      try { results[index] = await load(values[index], index); }
      catch (error) { if (!failed) failure = error; failed = true; }
    }
  }
  await Promise.all(Array.from({length: Math.min(values.length, Math.max(1, Math.floor(limit)))}, worker));
  if (failed) throw failure;
  return results;
}
