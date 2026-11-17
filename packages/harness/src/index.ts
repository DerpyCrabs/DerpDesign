/** Browser-side scenario lifecycle. Import from external support code only. */
export type Conditions = Record<string, unknown>;
export interface ScenarioContext { conditions: Conditions; signal: AbortSignal }
export interface HarnessState { ready: boolean; stage?: string; error?: string; reset: () => Promise<void> }
declare global { interface Window { __DERPDESIGN__?: HarnessState } }
export function readConditions(url: string = location.href): Conditions {
  const raw = new URL(url).searchParams.get('__derp_conditions');
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Pane conditions must be an object');
  return value as Conditions;
}
/** Setup must finish only when the intended fixture is ready. Cleanup owns mounted resources. */
export async function runScenario(setup: (context: ScenarioContext) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>) {
  let cleanup: void | (() => void | Promise<void>);
  let controller = new AbortController();
  let chain = Promise.resolve();
  const state: HarnessState = {ready:false, reset: () => {
    chain = chain.then(async () => {
      state.ready = false; state.stage='setup'; delete state.error;
      controller.abort(); await cleanup?.(); cleanup = undefined;
      controller = new AbortController();
      try {
        cleanup = await setup({conditions:readConditions(),signal:controller.signal});
        state.stage='fonts'; await document.fonts.ready;
        state.stage='paint'; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (!controller.signal.aborted) { state.ready = true; state.stage='ready'; }
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
    const current = chain;
    // A failed setup must be recoverable via the next explicit reset.
    chain = current.catch(() => {});
    return current;
  }};
  window.__DERPDESIGN__ = state;
  window.addEventListener('pagehide', () => { controller.abort(); void cleanup?.(); }, {once:true});
  await state.reset();
  return state;
}
