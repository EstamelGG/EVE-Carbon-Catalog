// Viewer-written parser and binding adapters. Expression inputs and stochastic functions follow
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/SmartLightSets/attributeModifiers/EveSmartLightAttributeModifierExpressionBucket.cpp#L12-L82
import {randomHash} from './smart-light-random.js';
import {perlinNoise1D} from './trinity-noise.js';
const levels=[['||'],['&&'],['==','!='],['<','<=','>','>='],['+','-'],['*','/','%'],['^']];
const operations={'+':(a,b)=>a+b,'-':(a,b)=>a-b,'*':(a,b)=>a*b,'/':(a,b)=>a/b,'%':(a,b)=>a%b,'^':Math.pow,
  '<':(a,b)=>Number(a<b),'<=':(a,b)=>Number(a<=b),'>':(a,b)=>Number(a>b),'>=':(a,b)=>Number(a>=b),
  '==':(a,b)=>Number(a===b),'!=':(a,b)=>Number(a!==b)};
const functions={min:Math.min,max:Math.max,clamp:(a,b,c)=>Math.max(b,Math.min(c,a)),abs:Math.abs,
  sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,
  sqrt:Math.sqrt,exp:Math.exp,log:Math.log,pow:Math.pow,ceil:Math.ceil,floor:Math.floor};
const sum=(...args)=>args.reduce((a,b)=>a+b,0);
Object.assign(functions,{
  round:Math.round,rint:x=>x%1===.5||x%1===-.5 ? 2*Math.round(x/2) : Math.round(x),
  sign:Math.sign,ln:Math.log,log10:Math.log10,log2:Math.log2,sinh:Math.sinh,cosh:Math.cosh,
  tanh:Math.tanh,asinh:Math.asinh,acosh:Math.acosh,atanh:Math.atanh,sum,
  avg:(...args)=>args.length?sum(...args)/args.length:0,radians:x=>x*Math.PI/180,
  mod:(x,y)=>y===0?0:x%y,lerp:(a,b,x)=>a*(1-x)+b*x,
});
const sampleInput=(c,index,time)=>c.modifier.expressionInputs?.[Math.trunc(index+.5)]?.GetValueAt?.(time)??0;
const randomConstant=(c,a,b)=>a+(b-a)*c.randomConstant;
const contextual={
  input:(c,i)=>sampleInput(c,i,c.time),inputAt:sampleInput,randomConstant,randconst:randomConstant,
  random:(c,a,b)=>a+(b-a)*Math.random(),
  randhash:(c,a,b,x)=>randomHash(a,b,x,Math.floor(c.randomConstant*0x100000000)),
  noise:(c,x)=>(perlinNoise1D(x+c.randomConstant,1,1,1)+1)/2,
  fractal:(c,x,alpha,beta,n)=>(perlinNoise1D(x+c.randomConstant,alpha,beta,Math.trunc(n+.5))+1)/2,
};
const programs=new Map();

// Scalar grammar follows the public Carbon parser, including left-associative power.
export function compileLightExpression(source){
  if(programs.has(source))return programs.get(source);
  let program;
  try { program = parse(source); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    program = null;
  }
  programs.set(source,program);
  return program;
}
function parse(source){
  const lexer=/\s*(?:(\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.\d*)?(?:e[+-]?\d+)?)|([a-z_]\w*)|(\|\||&&|!=|==|<=|>=|[-+*/%^<>()!,?:]))/igy;
  const input=source.trim(),tokens=[];
  for(let i=0;i<input.length;){
    lexer.lastIndex=i;
    const match=lexer.exec(input);
    if(!match)throw new SyntaxError('Invalid light expression token at '+i);
    tokens.push(match[1]??match[2]??match[3]);i=lexer.lastIndex;
  }
  let index=0;
  function take(token){if(tokens[index]!==token)return false;index++;return true;}
  function expect(token){if(!take(token))throw new SyntaxError('Expected '+token+' in light expression');}
  function primary(){
    if(take('-')){const fn=primary();return c=>-fn(c);}
    if(take('+'))return primary();
    if(take('!')){const fn=primary();return c=>Number(!fn(c));}
    if(take('(')){const fn=conditional();expect(')');return fn;}
    const name=tokens[index++];
    if(!name)throw new SyntaxError('Incomplete light expression');
    if(/^\d|^\./.test(name)){const number=Number(name);return ()=>number;}
    if(take('(')){
      const args=[];
      if(!take(')')){do{args.push(conditional());}while(take(','));expect(')');}
      if(Object.hasOwn(contextual,name))return c=>contextual[name](c,...args.map(fn=>fn(c)));
      if(!Object.hasOwn(functions,name))throw new SyntaxError('Unsupported light function '+name);
      return c=>functions[name](...args.map(fn=>fn(c)));
    }
    if(name==='pi'||name==='pi2')return ()=>Math.fround(3.1415926)*(name==='pi2'?2:1);
    if(!['time','shipSpeed','shipMaxSpeed','input1'].includes(name))throw new SyntaxError('Unknown light variable '+name);
    return c=>c[name];
  }
  function binary(level){
    if(level===levels.length)return primary();
    let result=binary(level+1);
    while(levels[level].includes(tokens[index])){
      const op=tokens[index++],left=result,right=binary(level+1);
      result=op==='&&' ? c=>Number(Boolean(left(c)&&right(c))) :
        op==='||' ? c=>Number(Boolean(left(c)||right(c))) : c=>operations[op](left(c),right(c));
    }
    return result;
  }
  function conditional(){
    const condition=binary(0);
    if(!take('?'))return condition;
    const yes=conditional();expect(':');const no=conditional();
    return c=>condition(c)?yes(c):no(c);
  }
  const result=conditional();
  if(index!==tokens.length)throw new SyntaxError('Unexpected light expression suffix');
  return result;
}
