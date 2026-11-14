// Prepare off-scene, then commit only the changed slots. The unchanged objects
// and their running effects retain identity; connector offsets may translate them.
export async function replaceSubsystemRecords(
  records,
  parts,
  prepare,
  isCurrent,
  beforeCommit = () => {},
) {
  const changed = parts.flatMap((part, slot) =>
    records[slot].part.model === part.model &&
    records[slot].part.modelRevision === part.modelRevision
      ? []
      : [slot],
  );
  const results = await Promise.allSettled(changed.map((slot) => prepare(parts[slot], slot)));
  const prepared = results.flatMap((result, index) =>
    result.status === 'fulfilled' ? [{ slot: changed[index], record: result.value }] : [],
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure || !isCurrent()) {
    for (const { record } of prepared) record.dispose();
    if (failure) throw failure.reason;
    return false;
  }
  beforeCommit();
  for (const { slot, record } of prepared) {
    const previous = records[slot],
      parent = previous.root.parent,
      index = parent.children.indexOf(previous.root);
    parent.add(record.root);
    previous.root.removeFromParent();
    previous.dispose();
    parent.children.splice(parent.children.indexOf(record.root), 1);
    parent.children.splice(index, 0, record.root);
    records[slot] = record;
  }
  for (const [slot, record] of records.entries()) {
    record.part = parts[slot];
    record.root.position.fromArray(parts[slot].offset);
    record.root.updateMatrix();
  }
  return true;
}
