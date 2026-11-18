import {compileLightExpression} from './smart-light-expression.js';
import {perlinNoise1D} from './trinity-noise.js';

const RANDOM_CONSTANT=Math.fround(.21);
const copy=value=>ArrayBuffer.isView(value)?Array.from(value):Array.isArray(value)?value.map(copy):value;
const emptyScalar=()=>({type:'scalar',keys:[],before:0,after:0,scale:1,offset:0});

function wrappedTime(time,first,last,before,after){
  const length=last-first;
  if(length===0)return first;
  if(time<first){
    const quotient=-(time-first)/length,whole=Math.trunc(quotient);
    let fraction=quotient-whole;
    if(before===1||whole%2!==0)fraction=1-fraction;
    return fraction*length+first;
  }
  if(time<=last)return time;
  const quotient=(time-first)/length,whole=Math.trunc(quotient);
  let fraction=quotient-whole;
  if(after===2&&whole%2!==0)fraction=1-fraction;
  return fraction*length+first;
}

function segmentValue(time,left,right){
  const interpolation=left[4]??0;
  if(interpolation===0)return time===right[0]?right[1]:left[1];
  if(interpolation===1){
    const length=right[0]-left[0];
    return length===0?right[1]:left[1]+(right[1]-left[1])*(time-left[0])/length;
  }
  const length=right[0]-left[0];
  if(length===0)return right[1];
  const u=(time-left[0])/length,v=1-u;
  return (1+2*u)*v*v*left[1]+u*v*v*(left[3]??0)*length+
    u*u*(3-2*u)*right[1]-u*u*v*(right[2]??0)*length;
}

export function scalarCurveValue(spec,time){
  const keys=spec.keys||[];
  if(!keys.length)return 0;
  const first=keys[0],last=keys.at(-1);
  const scaled=time/(spec.scale??1)-(spec.offset??0);
  if(spec.before===3&&scaled<first[0])return first[1]-(first[0]-scaled)*(first[2]??0);
  if(spec.after===3&&scaled>last[0])return last[1]+(scaled-last[0])*(last[3]??0);
  if(keys.length===1)return first[1];
  if(spec.before===0&&scaled<=first[0])return first[1];
  if(spec.after===0&&scaled>=last[0])return last[1];
  const local=wrappedTime(scaled,first[0],last[0],spec.before??0,spec.after??0);
  let index=keys.length-2;
  for(let candidate=0;candidate+1<keys.length;candidate++){
    if(local>=keys[candidate][0]&&local<keys[candidate+1][0]){index=candidate;break;}
  }
  return segmentValue(local,keys[index],keys[index+1]);
}

function linearToGamma(value){
  return Math.pow(Math.max(0,value),.454545);
}

function linearFromSrgb(value){
  return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);
}

function eulerQuaternion(yaw,pitch,roll){
  const sinYaw=Math.sin(yaw/2),cosYaw=Math.cos(yaw/2);
  const sinPitch=Math.sin(pitch/2),cosPitch=Math.cos(pitch/2);
  const sinRoll=Math.sin(roll/2),cosRoll=Math.cos(roll/2);
  return [
    sinYaw*cosPitch*sinRoll+cosYaw*sinPitch*cosRoll,
    sinYaw*cosPitch*cosRoll-cosYaw*sinPitch*sinRoll,
    cosYaw*cosPitch*sinRoll-sinYaw*sinPitch*cosRoll,
    cosYaw*cosPitch*cosRoll+sinYaw*sinPitch*sinRoll,
  ];
}

function expressionContext(spec,time,state){
  const inputs=(spec.inputs||[]).map(input=>({GetValueAt:seconds=>curveValue(input,seconds)}));
  return {
    time:time/(state.scale??spec.scale??1),
    input1:state.input1??spec.input1??0,input2:state.input2??spec.input2??0,
    input3:state.input3??spec.input3??0,input4:state.input4??spec.input4??0,
    randomConstant:RANDOM_CONSTANT,
    modifier:{expressionInputs:inputs},
  };
}

export function curveValue(spec,time,state={}){
  switch(spec?.type){
    case 'scalar':
      return scalarCurveValue({...spec,scale:state.scale??spec.scale,offset:state.offset??spec.offset},time);
    case 'color':{
      const offset=state.offset??spec.offset??0;
      const value=[
        curveValue(spec.r??emptyScalar(),time-offset),
        curveValue(spec.g??emptyScalar(),time-offset),
        curveValue(spec.b??emptyScalar(),time-offset),
        spec.a?.keys?.length?curveValue(spec.a,time-offset):1,
      ];
      if(spec.srgb)for(let index=0;index<3;index++)value[index]=linearToGamma(Math.max(0,value[index]));
      return value;
    }
    case 'vector3':
      return [curveValue(spec.x,time),curveValue(spec.y,time),curveValue(spec.z,time)];
    case 'euler':
      return eulerQuaternion(curveValue(spec.yaw,time),curveValue(spec.pitch,time),curveValue(spec.roll,time));
    case 'constant':
      return copy(spec.value||[0,0,0,1]);
    case 'perlin':{
      const position=time*(state.speed??spec.speed??1)+RANDOM_CONSTANT;
      const noise=perlinNoise1D(position,state.alpha??spec.alpha??1.1,
        state.beta??spec.beta??2,Math.trunc((state.n??spec.n??3)+.5));
      return (noise+1)/2*(state.scale??spec.scale??1)+(state.offset??spec.offset??0);
    }
    case 'expression':{
      const program=compileLightExpression(spec.expression??'');
      return program?Number(program(expressionContext(spec,time,state)))||0:0;
    }
    case 'vector3Expression':{
      const context=expressionContext(spec,time,state);
      return (spec.expressions||['','','']).map(expression=>{
        const program=compileLightExpression(expression??'');
        return program?Number(program(context))||0:0;
      });
    }
    case 'colorMixer':{
      const color1=copy(state.color1??spec.color1??[0,0,0,1]);
      const color2=copy(state.color2??spec.color2??[0,0,0,1]);
      const lerp=state.lerpValue??spec.lerpValue??0;
      let value=color1.map((channel,index)=>channel+(color2[index]-channel)*lerp);
      const saturation=state.saturation??spec.saturation??1;
      if(saturation!==1){
        const intensity=value[0]*.299+value[1]*.587+value[2]*.114;
        value=value.map(channel=>intensity+(channel-intensity)*Math.max(0,saturation));
      }
      const brightness=state.brightness??spec.brightness??1;
      value=value.map(channel=>channel*brightness);
      const alpha=state.alphaOverride??spec.alphaOverride??-1;
      if(alpha!==-1)value[3]=Math.min(1,Math.max(0,alpha));
      return value;
    }
    default:
      throw Error('Unsupported gate curve '+spec?.type);
  }
}

function curveProperties(spec){
  switch(spec.type){
    case 'perlin':
      return {offset:spec.offset,scale:spec.scale,alpha:spec.alpha,speed:spec.speed,beta:spec.beta,n:spec.n};
    case 'expression':
      return {input1:spec.input1,input2:spec.input2,input3:spec.input3,input4:spec.input4,
        scale:spec.scale,randomConstant:RANDOM_CONSTANT};
    case 'vector3Expression':
      return {input1:spec.input1,input2:spec.input2,input3:spec.input3,input4:spec.input4,
        scale:spec.scale,randomConstant:RANDOM_CONSTANT};
    case 'colorMixer':
      return {color1:spec.color1,color2:spec.color2,lerpValue:spec.lerpValue,saturation:spec.saturation,
        brightness:spec.brightness,alphaOverride:spec.alphaOverride};
    default:
      return {};
  }
}

function initialValue(type,field){
  if(field==='scaling')return [1,1,1];
  if(field==='rotation')return [0,0,0,1];
  if(['translation','position','force'].includes(field))return [0,0,0];
  if(['color','minRange','maxRange'].includes(field))return [0,0,0,0];
  if(field==='display')return true;
  if(field==='value'&&['Tr2Vector2Parameter','Tr2Vector3Parameter','Tr2Vector4Parameter'].includes(type))
    return Array(type==='Tr2Vector2Parameter'?2:type==='Tr2Vector3Parameter'?3:4).fill(0);
  return 0;
}

function vectorWidth(type,field){
  if(field==='value'){
    if(type==='Tr2Vector2Parameter')return 2;
    if(type==='Tr2Vector3Parameter')return 3;
    if(['Tr2Vector4Parameter','Tr2ColorParameter','Tr2QuaternionParameter'].includes(type))return 4;
  }
  if(['rotation','color','minRange','maxRange'].includes(field))return 4;
  if(['translation','position','force','scaling'].includes(field))return 3;
  return 4;
}

export function compileGateRecipe(recipe){
  const objects=recipe.objects.map(entry=>{
    const curve=entry.curve;
    return {type:entry.type,curve,defaults:copy(entry.defaults||{}),
      properties:curve?curveProperties(curve):{}};
  });
  return function evaluate(time){
    const states=objects.map(entry=>({...entry.properties,...entry.defaults}));
    for(let index=0;index<objects.length;index++){
      const {curve}=objects[index];
      if(!curve)continue;
      const state=states[index];
      state.currentValue=curveValue(curve,time,state);
      if(curve.type==='perlin')state.value=state.currentValue;
      if(curve.type==='constant')state.value=state.currentValue;
      if(curve.type==='colorMixer'){
        const value=state.currentValue;
        state.convertedLinearValue=[linearFromSrgb(value[0]),linearFromSrgb(value[1]),linearFromSrgb(value[2]),value[3]];
      }
    }
    for(const binding of recipe.bindings){
      const source=states[binding.source],destination=states[binding.destination];
      const [sourceField,sourceAxis]=binding.sourceAttribute.split('.');
      let value=source?.[sourceField];
      if(value===undefined)value=binding.sourceValue;
      if(value===undefined)throw Error('Gate binding source is missing: '+binding.sourceAttribute);
      const inherited=value&&typeof value==='object'&&Number.isInteger(value.$colorSlot);
      if(sourceAxis&&inherited)throw Error('Inherited gate colors cannot bind one component');
      if(sourceAxis)value=value['xyzwrgba'.indexOf(sourceAxis)%4];
      const [field,axis]=binding.destinationAttribute.split('.');
      const gain=binding.scale??1,offset=binding.offset??[];
      if(inherited){
        const marker={$colorSlot:value.$colorSlot};
        if(gain!==1)marker.gain=gain;
        if(offset.some(Boolean))marker.offset=offset.slice(0,4);
        destination[field]=marker;
        continue;
      }
      value=copy(value);
      if(axis){
        const current=Array.isArray(destination[field])?copy(destination[field]):
          new Array(vectorWidth(objects[binding.destination].type,field)).fill(0);
        current['xyzwrgba'.indexOf(axis)%4]=Number(value)*gain+(offset[0]??0);
        destination[field]=current;
      }else if(Array.isArray(value)){
        destination[field]=value.map((channel,index)=>channel*gain+(offset[index]??0));
      }else if(Array.isArray(destination[field])){
        const current=destination[field]??initialValue(objects[binding.destination].type,field);
        destination[field]=current.map((_,index)=>Number(value)*gain+(offset[index]??0));
      }else{
        destination[field]=field==='display'?Boolean(value):Number(value)*gain+(offset[0]??0);
      }
    }
    const result=[];
    for(const output of recipe.outputs){
      (result[output.target]??={})[output.field]=copy(states[output.object]?.[output.field]);
    }
    return result;
  };
}
