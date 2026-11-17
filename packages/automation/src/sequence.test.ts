import {test,expect} from 'bun:test';
import {runSequence} from './sequence';
function fixture(){
 let generation=1,fingerprint='a',count=0;const events:any[]=[];
 const call=async(name:string,p:any={})=>{
  if(name==='workspace_info')return {selection:{generation,demoId:'demo'}};
  if(name==='pane_capture')return {id:'capture',sourceFingerprint:fingerprint,harnessFingerprint:'h'};
  if(name==='pane_input'){events.push(p.event);if(p.event.action==='up')count++;return {};}
  if(name==='pane_inspect'){if(p.selector==='#missing')throw Error('No matching element');return {element:{matchCount:p.selector==='#many'?2:1,bounds:{x:0,y:0,width:100,height:40},text:String(count)},computedStyles:{display:'block'}};}
  throw Error(name);
 };
 return {call,events,changeDemo(){generation++},changeSource(){fingerprint='b'}};
}
test('runs native input and reports asserted state with capture fingerprints',async()=>{
 const f=fixture();const r=await runSequence(f.call,'pane',{steps:[{action:'click',selector:'#button'},{action:'assert',selector:'#button',text:'1'},{action:'assert',selector:'#missing',exists:false},{action:'capture',label:'clicked'}]});expect(r.status).toBe('passed');expect(r.captures.map(c=>c.label)).toEqual(['initial','clicked','final']);expect(f.events.map(e=>e.action)).toEqual(['move','down','up']);
});
test('ambiguous selectors fail without sending input',async()=>{const f=fixture(),r=await runSequence(f.call,'pane',{steps:[{action:'click',selector:'#many'}]});expect(r.status).toBe('failed');expect(r.error).toContain('Step 1');expect(f.events).toHaveLength(0);});
test('negative assertions do not hide transport errors',async()=>{const f=fixture(),r=await runSequence(async(n,p)=>{if(n==='pane_inspect')throw Error('Engine disconnected');return f.call(n,p);},'pane',{steps:[{action:'assert',selector:'#missing',exists:false}]});expect(r.status).toBe('failed');expect(r.error).toContain('Engine disconnected');});
test('source changes invalidate a passing interaction',async()=>{const f=fixture(),r=await runSequence(async(n,p)=>{if(n==='pane_input')f.changeSource();return f.call(n,p);},'pane',{steps:[{action:'click',selector:'#button'}]});expect(r.status).toBe('failed');expect(r.error).toContain('Sources changed');});
test('selection changes prevent input into replacement demo',async()=>{const f=fixture(),r=await runSequence(async(n,p)=>{const result=await f.call(n,p);if(n==='pane_inspect')f.changeDemo();return result;},'pane',{steps:[{action:'click',selector:'#button'}]});expect(r.status).toBe('failed');expect(f.events).toHaveLength(0);});
test('drag releases pointer when an intermediate event fails',async()=>{const f=fixture();let moves=0;const r=await runSequence(async(n,p)=>{if(n==='pane_input'&&(p as any).event.action==='move'&&++moves===3)throw Error('move failed');return f.call(n,p);},'pane',{steps:[{action:'drag',from:{selector:'#a'},to:{selector:'#b'}}]});expect(r.status).toBe('failed');expect(f.events.at(-1).action).toBe('up');});
