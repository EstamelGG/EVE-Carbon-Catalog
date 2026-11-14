// Text replacement only; contains no lighting model or game constants.
export function replaceFunctionBody(source,name,body) {
  const start=source.indexOf('void '+name+'(');
  if(start<0) throw new Error('Unsupported shader function: '+name);
  const open=source.indexOf('{',start);let depth=1,end=open+1;
  for(;depth&&end<source.length;end++) {if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
  if(depth) throw new Error('Unbalanced shader function: '+name);
  return source.slice(0,open+1)+'\n'+body+'\n}'+source.slice(end);
}

