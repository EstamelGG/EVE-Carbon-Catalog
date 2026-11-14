// Start beside each mount, then use the nearest free vertical space.
export function layoutFittingLabels(points,width,height){
 const margin=12,gap=4,leader=24,result=[];
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const ordered=[...points].sort((a,b)=>a.x-b.x||a.y-b.y||a.index-b.index);
 for(const [index,p] of ordered.entries()){
  if(p.width+margin*2>width||p.height+margin*2>height)continue;
  const preferred=index<Math.ceil(ordered.length/2)?'left':'right';
  let best,score=Infinity;
  for(const side of [preferred,preferred==='left'?'right':'left']){
   const x=clamp(p.x+(side==='left'?-1:1)*(leader+p.width/2),margin+p.width/2,width-margin-p.width/2);
   const neighbors=result.filter(q=>Math.abs(q.xLabel-x)<(q.width+p.width)/2+gap);
   const candidates=[p.y,...neighbors.flatMap(q=>[q.yLabel-(q.height+p.height)/2-gap,q.yLabel+(q.height+p.height)/2+gap])];
   for(const candidate of candidates){
    const y=clamp(candidate,margin+p.height/2,height-margin-p.height/2);
    if(neighbors.some(q=>Math.abs(q.yLabel-y)<(q.height+p.height)/2+gap-.001))continue;
    const endX=side==='left'?x+p.width/2:x-p.width/2;
    const endY=clamp(p.y,y-p.height/2+3,y+p.height/2-3);
    const distance=Math.hypot(endX-p.x,endY-p.y)+Math.abs(y-p.y)*.2+(side===preferred?0:8);
    if(distance<score){
     score=distance;best={...p,xLabel:x,yLabel:y,side,line:`${p.x},${p.y} ${endX},${endY}`};
    }
   }
  }
  if(best)result.push(best);
 }
 return result;
}
