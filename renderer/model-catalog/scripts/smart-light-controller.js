import {compileLightExpression} from './smart-light-expression.js';

export function controllerValue(modifier, state) {
  const name = modifier.variableName;
  if (Object.hasOwn(state.controllerVariables ?? {}, name)) return state.controllerVariables[name];
  if (name === 'isDocked') return Number(Boolean(state.docked));
  if (name === 'IsWarping') return Number(Boolean(state.warping));
}

const constants=new WeakMap();
export function expressionValue(modifier, context, time) {
  const program = compileLightExpression(modifier.expression ?? '');
  if(!constants.has(modifier))constants.set(modifier,Math.random());
  return program ? program({modifier,randomConstant:constants.get(modifier),
    time, shipSpeed: context.shipSpeed ?? Number(Boolean(context.cruising)),
    shipMaxSpeed: context.shipMaxSpeed ?? 1,
  }) : modifier.currentValue ?? modifier.attributeMultiplier ?? 1;
}

// CCP Trinity f644516a, SmartLightSets/attributeModifiers/{BaseAttributeModifier,
// Bucket,ControllerVariableListener,ExpressionBucket,CameraDependency}.cpp.
// Advance shared state once per scene time; processing each locator only reads it.
export function lightController() {
  let states = new WeakMap(), previous;
  function get(m) {
    if (states.has(m)) return states.get(m);
    const listener = m.type.endsWith('ControllerVariableListener');
    const active = listener ? (m.defaultValue ?? 0) > .5 : m.active !== false;
    const changing = active && !listener && m.startsActive === false;
    const raw = Number(active && !changing);
    const s = {active, changing, raw, mapped:raw, final:m.attributeMultiplier ?? 1,
      strength:m.attributeMultiplier ?? 1, time:0, stamp:0};
    states.set(m,s);
    return s;
  }
  function reset(m,active) {
    const s=get(m);
    if(m.attributeModifiers) {
      for(const child of m.attributeModifiers) reset(child, active && s.active);
    } else {
      if(active !== s.active) s.changing=true;
      s.active=active;
      if(!active && m.restartPlayTimeWhenInactive !== false) s.time=0;
      s.stamp=s.time;
    }
  }
  function advance(m,parent,dt,context) {
    const s=get(m);
    if(m.type.endsWith('ControllerVariableListener')) {
      const value=controllerValue(m,context);
      if(value!==undefined && value!==s.delivered) {
        s.delivered=value;
        const active=m.invertReceivedValue ? value<1 : value>0;
        s.changing=active!==s.active;
        if(s.changing)reset(m,active);
        s.active=active;
      }
    }
    if(m.type.endsWith('ExpressionBucket')) {
      s.final=parent*s.strength*s.mapped;
      s.time+=dt;
      for(const child of m.attributeModifiers??[])advance(child,parent,dt,context);
      s.strength=expressionValue(m,context,s.time);
      return;
    }
    if(s.changing && s.active && s.time<s.stamp+(m.delayedActivation??0)) {
      if(parent>0)s.time+=dt;
    } else {
      if(s.changing) {
        const duration=m.crossFadeDuration??1;
        s.raw=duration===0 ? Number(s.active) : Math.max(0,Math.min(1,s.raw+(s.active?dt:-dt)/duration));
        const exponent=m.crossFadeIntensity??1;
        s.mapped=s.active ? s.raw**exponent : 1-(1-s.raw)**exponent;
        if(s.raw===Number(s.active)) {
          s.changing=false;
          if(s.active || m.restartPlayTimeWhenInactive!==false)
            for(const child of m.attributeModifiers??[])reset(child,s.active);
        }
      }
      s.final=parent*s.strength*s.mapped;
      if(s.final>0)s.time+=dt;
    }
    if(!m.type.endsWith('CameraDependency'))
      for(const child of m.attributeModifiers??[])advance(child,parent*s.final,dt,context);
  }
  return (groups,context)=>{
    const time=context.elapsed??0;
    if(time<previous){states=new WeakMap();previous=undefined;}
    const dt=previous===undefined?0:time-previous;
    previous=time;
    for(const group of groups)for(const m of group.attributeModifiers??[])advance(m,1,dt,context);
    return get;
  };
}
