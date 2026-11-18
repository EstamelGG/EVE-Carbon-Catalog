import {Quaternion} from 'three';
import {compileGateRecipe} from './gate-curve-runtime.js';
// Captured clips sample at frame / fps, clamping the last frame to the clip duration.
export const gateStates = ['Inactive', 'Active_Unlinked', 'Active_Linked'];
// Uniform samples use the two bracketing weights, as in Three.js r183 LinearInterpolant.
// https://github.com/mrdoob/three.js/blob/r183/src/math/interpolants/LinearInterpolant.js
const mixSamples = (left, right, fraction) => (1 - fraction) * left + fraction * right;
const interpolate = (a,b,t,field) => {
  if (typeof a === 'boolean') return a;
  if (Array.isArray(a)) {
    if(field==='rotation'&&a.length===4){
      // Published keys have no interpolation metadata. Choose shortest-arc
      // spherical interpolation to preserve angular speed between samples.
      const rotation=[];
      Quaternion.slerpFlat(rotation,0,a,0,b,0,t);
      const length=Math.hypot(...rotation);
      return length ? rotation.map(v=>v/length) : [0,0,0,1];
    }
    return a.map((v,i)=>mixSamples(v,b[i],t));
  }
  return mixSamples(a,b,t);
};
export function sampleTrack(track, time, fps, duration = Infinity) {
  const last=track.values.length-1;
  const at=time>=duration ? last : Math.max(0,Math.min(last,time*fps));
  const i=Math.floor(at);
  const frameSpan=Math.min(1,duration*fps-i);
  const fraction=frameSpan>0 ? (at-i)/frameSpan : 0;
  return interpolate(track.values[i],track.values[Math.min(i+1,last)],fraction,track.field);
}

export class GateAnimation {
  constructor(data) {
    // The viewer opens a linked gate, matching the selected public UI option.
    // The standalone BLACK controller instead defaults ActivationState to 0 (Inactive).
    this.data=data;this.state='Active_Linked';this.since=0;this.transition=null;
    this.transitionDuration=0;
    this.targets=data.targets.map(v=>({...v}));this.pulse=null;
    const fields=new Map();
    for(const set of data.sets)for(const track of set.tracks){
      if(!fields.has(track.target))fields.set(track.target,new Set());
      fields.get(track.target).add(track.field);
    }
    this.previousSets=new Set();
    this.animatedFields=fields;
    this.staticNodes=new WeakMap();
    this.parameterBindings=new WeakMap();
    this.selectedLoops=new Map();
    this.recipes=new Map();
    for(const set of data.sets)if(set.recipe)this.recipes.set(set,compileGateRecipe(set.recipe));
    this.hullName=null;this.hullSince=0;
  }
  hullAnimations(names) {
    if (!this.data.generic) return {names, initial:null};
    const matching=names.filter(name=>this.data.sets.some(set=>set.name===name.split('.').pop()));
    const initial=matching.find(name=>this.data.sets.some(set=>set.name===name.split('.').pop() && set.playing!==false));
    // Older captures only contain the active default state. Do not offer a
    // hull state whose corresponding effects have not been exported yet.
    return {names:!this.data.completeStates && matching.length ? matching : names, initial};
  }
  setState(state, elapsed) {
    if(!gateStates.includes(state))throw new Error('Invalid gate state');
    if(this.state===state)return false;
    this.transition=this.state+'2'+state;
    this.transitionDuration=0;
    // EveChildContainer::GetRangeDuration uses the maximum across named owners.
    for(const set of this.data.sets){
      if(set.name!=='Structure_Gate')continue;
      const range=set.ranges.find(r=>r.name===this.transition);
      if(range)this.transitionDuration=Math.max(this.transitionDuration,range.end-range.start);
    }
    this.state=state;this.since=elapsed;this.pulse=null;
    return true;
  }
  trigger(kind, elapsed) {
    if(!['arrival','departure'].includes(kind))throw new Error('Invalid gate event');
    this.pulse={kind,time:elapsed};
  }
  selectLoop(targets,name,elapsed){
    if(name==null){this.selectedLoops.clear();return true;}
    const found=new Map(),matched=new Set();
    for(const set of this.data.sets){
      const tracks=set.tracks.filter(track=>track.field==='display'&&targets.has(track.target));
      if(!tracks.length)continue;
      const range=set.ranges?.find(r=>r.name===name&&r.loop&&r.end>r.start);
      if(!range)return false;
      for(const track of tracks)matched.add(track.target);
      found.set(set,{range,since:elapsed});
    }
    if(matched.size!==targets.size)return false;
    this.selectedLoops=found;return true;
  }
  evaluate(elapsed, hull=null) {
    if (hull && this.hullName!==hull.name) {this.hullName=hull.name;this.hullSince=elapsed;}
    // Restore only tracks that wrote a value on the previous evaluation.
    // Overlapping controllers are reapplied below in their authored order.
    for(const set of this.previousSets)for(const {target,field} of set.tracks){
      const defaults=this.data.targets[target];
      if(Object.hasOwn(defaults,field))this.targets[target][field]=defaults[field];
      else delete this.targets[target][field];
    }
    this.previousSets.clear();
    for(const set of this.data.sets) {
      let time=(elapsed+(this.data.generic ? set.phase||0 : 0))%set.duration;
      const hullState=this.data.generic && hull?.names.includes(set.name);
      const loop=this.selectedLoops.get(set);
      if(loop){
        const {start,end}=loop.range;
        time=start+Math.max(0,elapsed-loop.since)%(end-start);
      } else if (hullState) {
        if (set.name!==hull.name) continue;
        const transition=/2|^Start|^End/.test(set.name);
        time=transition ? Math.min(hull.time,set.duration) : (elapsed-this.hullSince)%set.duration;
      } else if (this.data.generic && set.playing===false) continue;
      else if(this.data.generic && set.ranges?.length) {
        // Only advance the loop containing the captured controller time.
        // Other ranges are state transitions: keep their settled baseline.
        // Unranged sets (including play_start) can drive persistent rotation;
        // their name alone cannot distinguish ambient motion from spawning.
        const phase=set.phase||0;
        const range=set.ranges.find(r=>phase>=r.start && phase<r.end);
        if(!range || !(range.loop || range.name==='NormalLoop'))continue;
        const length=range.end-range.start;
        time=range.start+((phase-range.start+elapsed)%length+length)%length;
      }
      if(set.name==='Structure_Gate') {
        let age=Math.max(0,elapsed-this.since);
        const transitioning=age<this.transitionDuration;
        const range=set.ranges.find(r=>r.name===(transitioning?this.transition:this.state));
        if(!range)continue;
        if(!transitioning)age-=this.transitionDuration;
        const length=range.end-range.start;
        time=range.start+(range.loop&&length>0?age%length:Math.min(age,length));
      }
      this.previousSets.add(set);
      const recipe=this.recipes.get(set);
      if(recipe){
        const values=recipe(time);
        for(const output of set.recipe.outputs)
          this.targets[output.target][output.field]=values[output.target]?.[output.field];
      }else{
        for(const track of set.tracks)this.targets[track.target][track.field]=sampleTrack(track,time,set.fps,set.duration);
      }
    }
    return this.targets;
  }
  node(node){
    const target=this.targets[node.fxID];
    if(!target)return node;
    if(this.animatedFields.has(node.fxID))return {...node,...target};
    let snapshot=this.staticNodes.get(node);
    if(!snapshot){snapshot={...node,...target};this.staticNodes.set(node,snapshot);}
    return snapshot;
  }
  parameters(material) {
    let plan=this.parameterBindings.get(material);
    if(!plan){
      const bindings=Object.entries(material.fxParameters||{});
      const values={...material.parameters},dynamic=[];
      for(const [name,id] of bindings){
        if(this.animatedFields.get(id)?.has('value'))dynamic.push([name,id]);
        else if(this.targets[id]?.value!=null)values[name]=this.targets[id].value;
      }
      plan={values,dynamic};this.parameterBindings.set(material,plan);
    }
    if(!plan.dynamic.length)return plan.values;
    let values=plan.current??plan.values;
    // TriValueBinding::CopyValue writes the linked destination property. In the
    // published format the target ID addresses the evaluated parameter value.
    for (const [name, id] of plan.dynamic) {
      const sampled = this.targets[id]?.value;
      const next=sampled??plan.values[name],previous=values[name];
      if(previous===next || Array.isArray(previous)&&Array.isArray(next)&&previous.length===next.length&&previous.every((v,i)=>v===next[i]))continue;
      if(values===(plan.current??plan.values))values={...values};
      if(next===undefined&&!Object.hasOwn(plan.values,name))delete values[name];
      else values[name]=next;
    }
    plan.current=values;
    return values;
  }
}
