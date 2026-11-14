// Split on the widest remaining axis, keeping neighboring instances together
// in all three dimensions rather than creating long X-sorted strips.
export function spatialChunks(entries,limit=64,position=e=>e.position){
 if(entries.length<=limit)return [entries];
 const spans=[0,1,2].map(axis=>{const values=entries.map(e=>position(e).getComponent(axis));return Math.max(...values)-Math.min(...values);});
 const axis=spans.indexOf(Math.max(...spans));
 const sorted=[...entries].sort((a,b)=>position(a).getComponent(axis)-position(b).getComponent(axis));
 const middle=Math.floor(sorted.length/2);
 return [...spatialChunks(sorted.slice(0,middle),limit,position),...spatialChunks(sorted.slice(middle),limit,position)];
}
