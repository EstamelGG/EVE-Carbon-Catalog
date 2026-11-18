import test from 'node:test';
import assert from 'node:assert/strict';
import {GateAnimation} from './gate-animation.js';
import {compileGateRecipe,curveValue,scalarCurveValue} from './gate-curve-runtime.js';

const scalar=(values,options={})=>({type:'scalar',keys:values,before:0,after:0,scale:1,offset:0,...options});

test('scalar curves preserve Carbon interpolation and time scaling',()=>{
  const linear=scalar([[0,0,0,0,1],[2,10,0,0,1]]);
  assert.equal(scalarCurveValue(linear,1),5);
  assert.equal(scalarCurveValue({...linear,scale:2},2),5);
  assert.equal(scalarCurveValue({...linear,offset:.5},1),2.5);
  assert.equal(scalarCurveValue(scalar([[1,4,0,0,1]]),0),4);
});

test('expression and perlin curves use the fixed official preview phase',()=>{
  const expression={type:'expression',expression:'randconst(0,12)',inputs:[],input1:0,input2:0,input3:0,input4:0,scale:1};
  assert.ok(Math.abs(curveValue(expression,0)-2.52)<1e-6);
  assert.equal(curveValue(expression,0),curveValue(expression,40));
  const perlin={type:'perlin',offset:0,scale:150,alpha:1.1,speed:.1,beta:2,n:3};
  assert.equal(curveValue(perlin,1.25),curveValue(perlin,1.25));
  assert.notEqual(curveValue(perlin,1.25),curveValue(perlin,2.25));
});

test('expressions expose all four authored inputs and Carbon gamma conversion',()=>{
  const inputCurve=scalar([[0,0,0,0,1],[16,1,0,0,1]]);
  const expression={type:'expression',expression:'input2+inputAt(0,8)*input3+input4',
    inputs:[inputCurve],input1:0,input2:2,input3:3,input4:4,scale:1};
  assert.equal(curveValue(expression,0),7.5);
  const color={type:'color',srgb:true,offset:0,r:scalar([[0,.9911021,0,0,1]]),
    g:scalar([[0,.0273209,0,0,1]]),b:scalar([[0,.0065121,0,0,1]]),a:scalar([[0,1,0,0,1]])};
  const value=curveValue(color,0);
  assert.ok(Math.abs(value[1]-.1946779)<1e-6);
  assert.ok(Math.abs(value[2]-.1014467)<1e-6);
});

test('color mixers preserve Carbon alpha saturation and brightness',()=>{
  const mixer={type:'colorMixer',color1:[.2,.4,.8,1],color2:[.6,.2,0,0],lerpValue:.5,
    saturation:2,brightness:.5,alphaOverride:-1};
  const value=curveValue(mixer,0),intensity=.4*.299+.3*.587+.4*.114;
  const expected=[(2*.4-intensity)*.5,(2*.3-intensity)*.5,(2*.4-intensity)*.5,(1-intensity)*.5];
  value.forEach((channel,index)=>assert.ok(Math.abs(channel-expected[index])<1e-9));
});

test('color mixer linear output uses the authored sRGB transfer',()=>{
  const evaluate=compileGateRecipe({objects:[
    {curve:{type:'colorMixer',color1:[.5,.02732,0,1],color2:[.5,.02732,0,1],
      lerpValue:0,saturation:1,brightness:1,alphaOverride:-1}},
    {type:'Tr2Vector4Parameter'},
  ],bindings:[
    {source:0,sourceAttribute:'convertedLinearValue',destination:1,destinationAttribute:'value'},
  ],outputs:[{object:1,target:0,field:'value'}]});
  assert.ok(Math.abs(evaluate(0)[0].value[1]-.02732/12.92)<1e-9);
});

test('compiled gate recipes resolve ordered bindings and inherited colors',()=>{
  const recipe={objects:[
    {curve:{type:'scalar',keys:[[0,0,0,0,1],[2,1,0,0,1]],before:0,after:0,scale:1,offset:0}},
    {type:'EveChildInheritProperties'},
    {type:'EveChildContainer'},
    {defaults:{scale:1}},
  ],bindings:[
    {source:0,sourceAttribute:'currentValue',destination:3,destinationAttribute:'scale',scale:8},
    {source:3,sourceAttribute:'scale',destination:2,destinationAttribute:'brightness'},
    {source:1,sourceAttribute:'Primary',sourceValue:{$colorSlot:2},destination:2,destinationAttribute:'color'},
  ],outputs:[
    {object:2,target:0,field:'brightness'},
    {object:2,target:0,field:'color'},
  ]};
  const evaluate=compileGateRecipe(recipe),value=evaluate(1)[0];
  assert.equal(value.brightness,4);
  assert.deepEqual(value.color,{$colorSlot:2});
});

test('GateAnimation evaluates recipes at render time',()=>{
  const data={targets:[{brightness:0}],completeStates:true,sets:[{
    name:'Structure_Gate',duration:2,fps:30,playing:true,
    ranges:[{name:'Active_Linked',start:0,end:2,loop:false}],
    tracks:[{target:0,field:'brightness',values:[0]}],
    recipe:{version:1,objects:[
      {curve:{type:'scalar',keys:[[0,0,0,0,1],[2,2,0,0,1]],before:0,after:0,scale:1,offset:0}},
    ],bindings:[
      {source:0,sourceAttribute:'currentValue',destination:0,destinationAttribute:'brightness'},
    ],outputs:[{object:0,target:0,field:'brightness'}]},
  }]};
  const animation=new GateAnimation(data);
  assert.equal(animation.evaluate(1.5)[0].brightness,1.5);
  assert.equal(animation.evaluate(0.5)[0].brightness,.5);
});

test('GateAnimation samples authored state transitions before settling',()=>{
  const data={targets:[{brightness:0}],completeStates:true,sets:[{
    name:'Structure_Gate',duration:3,fps:30,playing:false,
    ranges:[
      {name:'Inactive',start:0,end:.25,loop:false},
      {name:'Active_Linked',start:.25,end:.5,loop:false},
      {name:'Active_Linked2Inactive',start:.5,end:2.5,loop:false},
    ],
    tracks:[],
    recipe:{version:1,objects:[
      {curve:{type:'scalar',keys:[[0,0,0,0,1],[3,3,0,0,1]],before:0,after:0,scale:1,offset:0}},
      {type:'EveChildContainer'},
    ],bindings:[
      {source:0,sourceAttribute:'currentValue',destination:1,destinationAttribute:'brightness'},
    ],outputs:[{object:1,target:0,field:'brightness'}]},
  }]};
  const animation=new GateAnimation(data);
  animation.evaluate(0);
  assert.equal(animation.setState('Inactive',10),true);
  assert.equal(animation.transition,'Active_Linked2Inactive');
  assert.equal(animation.transitionDuration,2);
  assert.equal(animation.evaluate(10)[0].brightness,.5);
  assert.equal(animation.evaluate(11)[0].brightness,1.5);
  assert.equal(animation.evaluate(12.5)[0].brightness,.25);
});
