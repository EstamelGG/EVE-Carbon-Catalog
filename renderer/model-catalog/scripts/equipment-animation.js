import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';

// Trinity plays Deploy/Pack once, then loops Active/Inactive at the authored
// duration. The preview advances only the current action on the Three mixer.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/Turret/EveTurretSet.cpp#L2535-L2560
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/Turret/EveTurretSet.cpp#L2728-L2810
// https://github.com/mrdoob/three.js/blob/r183/src/animation/AnimationAction.js
const movingClips = new WeakMap();

function changesPose(clip) {
  if (!clip || clip.duration <= 0) return false;
  if (!movingClips.has(clip)) {
    const moving = clip.tracks.some(track => {
      if (track.times.length < 2) return false;
      if (track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline) return true;
      const stride = track.getValueSize();
      return track.values.some((value, i, values) => i >= stride && value !== values[i % stride]);
    });
    movingClips.set(clip, moving);
  }
  return movingClips.get(clip);
}

export function equipmentAnimation(model, clips) {
  const mixer = new AnimationMixer(model);
  const named = name => clips.find(clip => clip.name.split('.').pop().toLowerCase() === name);
  let remaining = 0;
  let nextClip;
  let looping = false;

  function playRest(clip) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.play();
    mixer.update(0);
    looping = changesPose(clip);
  }

  return {
    pose(deployed, transition) {
      mixer.stopAllAction();
      looping = false;
      const move = transition && named(deployed ? 'deploy' : 'pack');
      const rest = named(deployed ? 'active' : 'inactive');
      remaining = move?.duration || 0;
      nextClip = undefined;
      if (remaining > 0) {
        nextClip = rest;
        const action = mixer.clipAction(move).reset().setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.update(0);
      } else if (rest) {
        playRest(rest);
      } else if (clips.length) {
        // Historical equipment without named states keeps its preview fallback.
        const clip = move || clips[0];
        const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.update(clip.duration);
      }
    },
    update(delta) {
      if (remaining > 0) {
        const step = Math.min(delta, remaining);
        mixer.update(step);
        delta -= step;
        remaining -= step;
        if (remaining === 0 && nextClip) playRest(nextClip);
      }
      if (looping && delta > 0) mixer.update(delta);
      return remaining > 0 || looping;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    },
  };
}
