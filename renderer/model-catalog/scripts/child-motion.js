import {Euler, Quaternion} from 'three';
import {scalarInput} from './cloud-brightness.js';

function sample(channel, seconds) {
  if (typeof channel === 'number') return channel;
  const {keys} = channel, first = keys[0], last = keys.at(-1);
  let t = seconds / channel.scale - channel.offset;
  const before = t < first[0], after = t > last[0];
  if (before || after) {
    const edge = before ? first : last, mode = before ? channel.before : channel.after;
    const period = last[0] - first[0];
    if (!mode || period <= 0) return edge[1];
    if (mode === 3) return edge[1] + (t-edge[0]) * edge[before ? 2 : 3];
    const cycles = Math.abs(t-first[0]) / period;
    let phase = cycles % 1;
    if ((before && mode === 1) || (mode === 2 && Math.floor(cycles) % 2)) phase = 1-phase;
    t = first[0] + phase * period;
  }
  return scalarInput(keys, t);
}

// Each packet references its own curve-bound containers. Only the mutable
// poses are instance-owned; meshes, textures and immutable keys remain shared.
export function bindChildMotion(source) {
  if (!source?.motionTracks?.length) return null;
  const poses = new Map();
  function bindNode(node) {
    const id = node.motionTrack;
    if (id === undefined) return node;
    if (!poses.has(id)) poses.set(id, {...node});
    return poses.get(id);
  }
  function bindRecord(record) {
    const field = record.transforms ? 'transforms' : 'parents';
    if (!record[field]?.some(node => node.motionTrack !== undefined)) return record;
    return {...record, [field]: record[field].map(bindNode)};
  }
  const supplements = {...source};
  for (const list of ['meshes','transparent','lights','flares','softFlares','lines']) {
    if (source[list]) supplements[list] = source[list].map(bindRecord);
  }
  if (source.particles) supplements.particles = source.particles.map(group => ({...group, draws:group.draws.map(bindRecord)}));
  const euler = new Euler(), quaternion = new Quaternion();
  const bindings = [];
  for (const [id, pose] of poses) {
    for (const [field, track] of Object.entries(source.motionTracks[id])) {
      const values = new Array(track.channels.length);
      const result = field === 'rotation' ? new Array(4) : values;
      if (field !== 'display') pose[field] = result;
      bindings.push(time => {
        track.channels.forEach((channel,i) => { values[i] = sample(channel,time*track.clock); });
        if (field === 'rotation') quaternion.setFromEuler(euler.set(values[1],values[0],values[2],'YXZ')).toArray(result);
        for (let i=0;i<result.length;i++) result[i] = result[i]*track.gain + (track.offset[i]??0);
        if (field === 'display') pose.display = Boolean(result[0]);
      });
    }
  }
  const update = time => { for (const apply of bindings) apply(time); };
  update(0);
  return {supplements, update};
}
