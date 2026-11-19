import {installFixtureLocks} from './browser-mocks';
import {runScenario} from '../../packages/harness/src/index';
installFixtureLocks();
window.__DERPDESIGN__ = {ready:false,reset:async()=>location.reload()};
try { await import('@televecha/main'); }
catch(error) { window.__DERPDESIGN__.error=String(error); throw error; }

await runScenario(async ({signal,conditions}) => {
  async function waitFor<T>(read:()=>T | undefined): Promise<T> {
    return new Promise((resolve,reject) => {
      const check=()=>{
        if(signal.aborted) return reject(Error('Scenario aborted'));
        try {
          const value=read();
          if(value!==undefined) return resolve(value);
          requestAnimationFrame(check);
        } catch(error) { reject(error); }
      };
      check();
    });
  }
  const conversation=String(conditions.conversation ?? 'Alice Fixture');
  const row=await waitFor(()=>{
    const runtimes=(window as any).__televechaRuntimes;
    const snapshot=runtimes && [...runtimes.values()][0]?.engine.snapshot();
    window.__DERPDESIGN__!.stage=`runtime: ${snapshot?.phase ?? 'starting'}`;
    if(snapshot?.phase==='error') throw Error(snapshot.error || 'TeleVecha fixture startup failed');
    if(snapshot?.phase!=='ready' || !snapshot.online) return;
    return [...document.querySelectorAll<HTMLElement>('[data-testid="chat-list"] .chat-row')]
      .find(element=>element.textContent?.includes(conversation));
  });
  if(conditions.scenario==='inbox') {
    (document.querySelector('[aria-label="Close details"]') as HTMLElement | null)?.click();
    if(innerWidth<=650)(document.querySelector('[aria-label="Open chat list"]') as HTMLElement | null)?.click();
    return;
  }
  row.click();
  window.__DERPDESIGN__!.stage='conversation';
  await waitFor(()=>{
    const header=document.querySelector('[data-testid="conversation-header"]');
    const composer=document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]');
    return header?.textContent?.includes(conversation) && (conditions.scenario==='channel' || composer && !composer.readOnly) ? true : undefined;
  });
});
