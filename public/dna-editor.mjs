import {savedResBase,defaultResBase} from './res-preference.mjs';
import {siteLocale} from './locale.mjs';

const el=id=>document.getElementById(id);
const en=siteLocale()==='en', text=(zh,enText)=>en?enText:zh;
document.documentElement.lang=siteLocale();
const initial=new URL(location.href).searchParams.get('dna')||'';
const [initialHull,initialFaction,initialRace,...initialArgs]=initial.toLowerCase().split(':');
const initialParts=new Map(initialArgs.map(segment=>segment.split('?')));
let recipes,palette,options,base,selection=0,revision=0,timer;
const reads=new Map();
function read(url){
  if(!reads.has(url))reads.set(url,fetch(url).then(r=>{
    if(!r.ok)throw Error(r.status+' · '+url);return r.json();
  }).catch(e=>{reads.delete(url);throw e;}));
  return reads.get(url);
}
function select(id,values,preferred,optional=false){
  const field=el(id), old=preferred??field.value;
  field.replaceChildren(...(optional?[new Option(text('默认','Default'),'')]:[]),
    ...values.sort().map(v=>new Option(v,v)));
  if([...field.options].some(o=>o.value===old))field.value=old;
}
function slots(container,n,prefix){
  return Array.from({length:n},(_,i)=>{
    const label=document.createElement('label'),field=document.createElement('input');
    label.textContent=prefix+' '+(i+1);field.setAttribute('list','palette');
    field.placeholder=text('默认','Default');field.autocomplete='off';
    label.append(field);el(container).append(label);return field;
  });
}
const materials=slots('materials',4,text('材质','Material'));
const pMaterials=slots('pattern-slots',2,text('图案材质','Pattern material'));
function names(fields){return fields.map(field=>field.value.trim().toLowerCase()||'none');}
function compose(){
  if(!palette)return;
  const pattern=el('pattern').value;
  for(const field of pMaterials)field.disabled=!pattern;
  const values=names(materials), pvalues=names(pMaterials);
  const parts=[el('hull').value,el('faction').value,el('race').value];
  if(values.some(v=>v!=='none'))parts.push('material?'+values.join(';'));
  if(pattern)parts.push('pattern?'+[pattern,...pvalues].join(';'));
  if(el('insert').value)parts.push('respathinsert?'+el('insert').value);
  const value=parts.join(':'), dna=el('dna');dna.value=value;
  const current=++revision;clearTimeout(timer);
  for(const name of [...values,...(pattern?pvalues:[])])if(name!=='none'&&!Object.hasOwn(palette.materials,name)){
    el('status').textContent=text('未知材质','Unknown material')+' · '+name;el('copy').disabled=true;return;
  }
  el('copy').disabled=false;
  const route=new URL(location.href);route.searchParams.set('dna',value);history.replaceState(null,'',route);
  el('status').textContent=text('正在装配…','Assembling…');
  timer=setTimeout(async()=>{
    try{
      await el('viewer').configure({dna:value,itemId:null,resBase:base,controlPanel:true,language:siteLocale()});
      if(current===revision)el('status').textContent='';
    }catch(error){if(current===revision)el('status').textContent=error.message;}
  },180);
}
async function choose(first=false){
  const seq=++selection;revision++;clearTimeout(timer);palette=null;
  el('modifiers').disabled=true;el('copy').disabled=true;
  try{
    const hull=el('hull').value;
    select('faction',Object.keys(recipes).filter(k=>k.startsWith(hull+':')).map(k=>k.split(':')[1]),first?initialFaction:undefined);
    const entry=recipes[hull+':'+el('faction').value];
    const url=key=>new URL(key.slice(4),base);
    const [next,opts]=await Promise.all([read(url(entry.recipe.palette).href),read(url(entry.recipe.options).href)]);
    if(seq!==selection)return;
    palette=next;options=opts;
    if(first && initial){
      const pattern=initialParts.get('pattern')?.split(';')[0], insert=initialParts.get('respathinsert');
      if(!Object.hasOwn(palette.races,initialRace) || (pattern && !Object.hasOwn(opts.patterns,pattern)) ||
         (insert && insert!=='none' && !Object.hasOwn(opts.inserts,insert)) ||
         [...initialParts.keys()].some(k=>!['material','pattern','respathinsert'].includes(k)))
        throw Error(text('链接包含此资源库未提供的 DNA 选项。','This DNA link requires options absent from this resource library.'));
    }
    const race=first?initialRace:el('race').value;
    select('race',Object.keys(palette.races),Object.hasOwn(palette.races,race)?race:entry.baseRace);
    el('palette').replaceChildren(...Object.keys(palette.materials).sort().map(v=>new Option(v,v)));
    select('pattern',Object.keys(options.patterns),first?initialParts.get('pattern')?.split(';')[0]:undefined,true);
    select('insert',['none',...Object.keys(options.inserts)],first?initialParts.get('respathinsert'):undefined,true);
    if(first){
      for(const [fields,args] of [[materials,initialParts.get('material')?.split(';')],[pMaterials,initialParts.get('pattern')?.split(';').slice(1)]])
        fields.forEach((f,i)=>{f.value=args?.[i] && args[i]!=='none'?args[i]:'';});
    }
    el('modifiers').disabled=false;compose();
  }catch(error){if(seq===selection)el('status').textContent=error.message;}
}
el('controls').onsubmit=e=>e.preventDefault();
el('hull').onchange=()=>choose();el('faction').onchange=()=>choose();
el('race').onchange=compose;el('modifiers').oninput=compose;
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('dna').value);}
  catch{el('dna').focus();el('dna').select();}};
async function init(){
  if(en){
    document.title='DNA recipes · EVE Carbon';document.querySelector('h1').textContent='DNA recipes';
    el('components').querySelector('legend').textContent='Components';el('modifiers').querySelector('legend').textContent='Materials and pattern';
    for(const [id,label] of [['hull','Hull'],['faction','Faction'],['race','Race'],['pattern','Projected pattern'],['insert','Texture variant · respathinsert']])
      el(id).parentElement.firstChild.textContent=label;
    el('copy').textContent='Copy DNA';
  }
  const config=await read('./site-config.json');base=savedResBase()||defaultResBase(config);
  const [index]=await Promise.all([read(new URL('model-index.json',base).href),import(config.rendererModuleURL||'./eve-model-viewer.js')]);
  recipes=index.dnaRecipes||{};
  if(!Object.keys(recipes).length)throw Error(text('当前资源站尚未发布 DNA 配方库。','This resource site has no published DNA recipes.'));
  const hulls=[...new Set(Object.keys(recipes).map(k=>k.split(':')[0]))];
  if(initial && !Object.hasOwn(recipes,initialHull+':'+initialFaction))
    throw Error(text('链接中的舰体或阵营未发布。','The hull or faction in this link has not been published.'));
  select('hull',hulls,initialHull||'mf4_t1');el('components').disabled=false;await choose(true);
}
init().catch(error=>{el('status').textContent=error.message;});
