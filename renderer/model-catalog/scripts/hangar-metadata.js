// A fixed SOF sphere is valid for the exact hull revision and DNA.
export function hangarSourceRadius(document,entry,metadata){
 const embedded=document?.sourceRadiusOrigin==='sof-hull-boundingSphere'?document.sourceRadius:null;
 const record=metadata?.version===2?metadata.ships?.[entry?.modelRevision]:null;
 const source=record?.dna===entry?.dna&&record?.sourceRadiusOrigin==='sof-hull-boundingSphere'?record.sourceRadius:null;
 return [embedded,source].find(value=>Number.isFinite(value)&&value>0);
}
