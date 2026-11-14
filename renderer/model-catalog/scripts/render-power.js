// model-viewer replaces its shared context through Renderer.resetSingleton.
// https://github.com/google/model-viewer/blob/adc877c66f97e1498d8b19a8850976aee3d0197f/packages/model-viewer/src/three-components/Renderer.ts#L78-L87
export const powerPreferences=['default','low-power','high-performance'];
export function normalizePowerPreference(value){
  if(!powerPreferences.includes(value))throw new TypeError('powerPreference must be default, low-power or high-performance');
  return value;
}

// All model-viewer instances share one context. Close their owned sessions
// before replacing it, then reload active instances with their saved options.
export function createRenderPower({initial='high-performance',replace}){
  let value=normalizePowerPreference(initial);
  const clients=new Set(), pending=new Set();
  function resumePending() {
    for(const client of [...pending]) {
      if(pending.delete(client))client.resume(value);
    }
  }
  return {
    get value(){return value;},
    register(client){clients.add(client);return ()=>{clients.delete(client);pending.delete(client);};},
    select(requested,owner){
      const next=normalizePowerPreference(requested??value);
      if(next===value)return value;
      const active=[...clients].filter(client=>client.stop(client===owner));
      replace(next);value=next;
      for(const client of clients)client.sync(value);
      // Rapid preference changes share one final restore. The latest owner is
      // already opening its own session in component-controller.configure().
      for(const client of active)if(clients.has(client))pending.add(client);
      pending.delete(owner);
      if(pending.size)queueMicrotask(resumePending);
      return value;
    },
  };
}
