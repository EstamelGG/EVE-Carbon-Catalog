const $ = id => document.getElementById(id);
const label = item => item.name?.zh || item.name?.en || String(item.id);
const nav = document.querySelector('nav');
const categories = await fetch('catalog.json').then(r => r.json());
const entries = new Map();
for(const category of categories) for(const group of category.groups) for(const item of group.items)
  entries.set(item.id,{category,group,item});
let selected;
function branch(name,open){
  const details=document.createElement('details'), summary=document.createElement('summary');
  summary.textContent=name; details.open=open; details.append(summary);return details;
}
function drawTree(){
  const query=$('search').value.trim().toLowerCase();
  const tree=document.createDocumentFragment();
  for(const category of categories){
    const cat=branch(label(category),!!query || selected?.category===category);
    for(const group of category.groups){
      const section=branch(label(group),!!query || selected?.group===group);
      for(const item of group.items){
        if(query && ![item.id,item.name?.zh,item.name?.en].join(' ').toLowerCase().includes(query))continue;
        const button=document.createElement('button');button.textContent=label(item);
        button.setAttribute('aria-current',String(selected?.item.id===item.id));
        button.onclick=()=>{location.hash='item='+item.id};section.append(button);
      }
      if(section.childElementCount>1)cat.append(section);
    }
    if(cat.childElementCount>1)tree.append(cat);
  }
  nav.replaceChildren(tree.childNodes.length?tree:document.createTextNode('没有匹配的物品'));
}
function show(){
  const id=new URLSearchParams(location.hash.slice(1)).get('item') ?? '85236';
  selected=entries.get(Number(id));drawTree();$('stage').replaceChildren();
  const item=selected?.item;
  $('name').textContent=item?label(item):'找不到该物品';
  $('trail').textContent=item?[label(selected.category),label(selected.group)].join(' / '):'';
  $('type').textContent=item?'TypeID '+item.id:'';
  $('sequence').textContent=item?.dna || '无';$('status').textContent='';
  if(!item?.dna){if(item)$('status').textContent='此物品没有 SOF DNA';return;}
  const viewer=document.createElement('eve-model-viewer');
  viewer.setAttribute('dna',item.dna);viewer.setAttribute('control-panel','');
  viewer.addEventListener('error',e=>{$('status').textContent=e.detail.message});
  $('stage').append(viewer);document.title=label(item)+' · EVE 物品图鉴';
}
$('search').addEventListener('input',drawTree);window.addEventListener('hashchange',show);show();
