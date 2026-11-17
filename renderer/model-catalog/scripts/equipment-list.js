import {groupHardpoints,logicalHardpoints,planEquipmentPlacements} from './equipment-hardpoints.js';

export function equipmentList(value){
 if(value===undefined)return undefined;
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw new TypeError('equipment must be an array of item IDs');}}
 if(!Array.isArray(value))throw new TypeError('equipment must be an array of item IDs');
 return Array.from(value,(id,index)=>{
  if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new TypeError(`Invalid equipment ID at position ${index+1}`),{equipmentIndex:index,itemId:id});
  return id;
 });
}

// Validate each prefix of the requested list before touching the current scene.
// The existing allocator resolves native families and overlapping positions.
export function equipmentChoices(ids,locators,equipment,hullCategory=6,definitions=[]){
 const slots=logicalHardpoints(groupHardpoints(locators),definitions),choices=new Map();
 for(const [index,id] of ids.entries()){
  choices.set(index+1,id);
  try{
   if(index>=slots.length||!equipment.some(item=>item.id===id&&item.supported!==false))throw Error('Unknown or unsupported equipment');
   planEquipmentPlacements(slots,choices,equipment,hullCategory);
  }catch(cause){throw Object.assign(new Error(`Equipment ${index+1} (ID ${id}) cannot be installed: ${cause.message}`),{equipmentIndex:index,itemId:id,cause});}
 }
 return choices;
}
