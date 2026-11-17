import {start} from '../../packages/workspace/src/main';
import {mkdir,readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..'),directory=resolve(root,'.local/verification/host-loss-'+crypto.randomUUID());
await mkdir(directory,{recursive:true});
const fixture=Bun.serve({port:0,fetch:()=>new Response('<!doctype html><button>Host loss</button>',{headers:{'content-type':'text/html'}})});
const {workspace,server}=await start({directory,port:0,token:crypto.randomUUID(),desktopToken:'isolated-host-loss-test'});
await workspace.call('project.register',{id:'p',name:'Host loss',sourceRoot:root,supportRoot:root,server:{command:['sleep','120'],cwd:root,url:`http://127.0.0.1:${fixture.port}`}});
await workspace.call('demo.put',{id:'d',projectId:'p',name:'Host loss',description:'Abrupt native host termination',panes:['chromium','ladybird'].map(engine=>({id:engine,name:engine,engine,viewport:{width:400,height:300,deviceScaleFactor:'display'},position:{x:0,y:0},route:'/',conditions:{}}))});
const proc=Bun.spawn([resolve(root,'build/desktop/derpdesign')],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_DESKTOP_TOKEN:'isolated-host-loss-test',DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_CHROMIUM_WORKER:resolve(root,'.local/engines/chromium/build/derp-chromium'),DERP_LADYBIRD_WORKER:resolve(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird')},stdout:Bun.file(resolve(directory,'stdout.log')),stderr:Bun.file(resolve(directory,'stderr.log'))});
async function processes(){const result=new Map<number,{parent:number,state:string}>();for(const name of await readdir('/proc'))if(/^\d+$/.test(name)){try{const fields=(await readFile(`/proc/${name}/stat`,'utf8')).split(') ')[1].split(' ');result.set(Number(name),{state:fields[0],parent:Number(fields[1])})}catch{}}return result}
let children=new Set<number>();
try{
 for(let i=0;!workspace.socket;i++){assert(i<100&&proc.exitCode===null,'Host failed to start');await Bun.sleep(100)}
 await workspace.call('selection.set',{projectId:'p',demoId:'d'});
 for(const paneId of ['chromium','ladybird'])await workspace.call('pane.capture',{paneId});
 const tree=await processes();children.add(proc.pid);let added=true;while(added){added=false;for(const [pid,p] of tree)if(children.has(p.parent)&&!children.has(pid)){children.add(pid);added=true}}
 children.delete(proc.pid);assert(children.size>=2,'No engine descendants found');
 let perProcess=new Map<number,number>();
 async function ticks(){let total=0;for(const pid of [proc.pid,...children]){try{let f=(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ')[1].split(' ');let value=Number(f[11])+Number(f[12]);perProcess.set(pid,value);total+=value}catch{}}return total}
 await Bun.sleep(500);let before=await ticks(),initial=new Map(perProcess),start=performance.now();await Bun.sleep(1000);
 const hz=Number(await new Response(Bun.spawn(['getconf','CLK_TCK'],{stdout:'pipe'}).stdout).text());
 const cpuSeconds=((await ticks())-before)/hz,elapsed=(performance.now()-start)/1000;
 console.log('Idle CPU across desktop and both engine process trees:',(100*cpuSeconds/elapsed).toFixed(1)+'%');
 for(const [pid,value] of perProcess){let delta=value-(initial.get(pid)||value);if(delta>10)console.log('CPU process',pid,(await readFile(`/proc/${pid}/comm`,'utf8')).trim(),delta/hz/elapsed*100)}
 assert(cpuSeconds/elapsed<0.5,'Idle static demo is busy-spinning');
 // Freeze a real Ladybird renderer to prove cleanup does not depend on its event loop.
 let frozen:number|undefined;for(const pid of children){try{if((await readFile(`/proc/${pid}/comm`,'utf8')).trim()==='WebContent'){process.kill(pid,'SIGSTOP');frozen=pid;break}}catch{}}
 assert(frozen,'Ladybird renderer not found');
 proc.kill('SIGKILL');await proc.exited;
 let survivors:number[]=[];
 for(let i=0;i<100;i++){const live=await processes();survivors=[...children].filter(pid=>live.has(pid)&&live.get(pid)!.state!=='Z');if(!survivors.length)break;await Bun.sleep(100)}
 assert.deepEqual(survivors,[],'Engine descendants survived abrupt desktop death');
 console.log('PASS abrupt offscreen desktop death: all',children.size,'engine descendants stopped');
}finally{if(proc.exitCode===null)proc.kill();await workspace.stop();server.stop(true);fixture.stop(true)}
