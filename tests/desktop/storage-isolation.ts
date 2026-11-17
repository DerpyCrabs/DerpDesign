import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const directory=resolve(root,'.local/verification/isolation-'+randomUUID());
await mkdir(directory,{recursive:true});
const app=Bun.spawn(['bun','scripts/start.ts'],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_WORKSPACE_PORT:'47893',DERP_STATE_DIR:directory,DERP_SCREENSHOT:resolve(directory,'canvas.png'),DERP_SCREENSHOT_DELAY_MS:'30000'},stdout:Bun.file(resolve(directory,'host.log')),stderr:Bun.file(resolve(directory,'host-errors.log'))});
await writeFile(resolve(directory,'index.html'),`<!doctype html><meta charset="utf-8"><style>button{width:180px;height:50px}</style><button id="write">Write storage</button><output id="state"></output><script>
function report(){document.querySelector('#state').textContent=JSON.stringify({local:localStorage.getItem('key'),session:sessionStorage.getItem('key'),cookie:document.cookie})}
document.querySelector('#write').onclick=()=>{localStorage.setItem('key','written');sessionStorage.setItem('key','written');document.cookie='key=written;path=/';report()};report();</script>`);
const client=new Client({name:'mixed-engine-verifier',version:'1'});
try {
 for(let i=0;;i++){
  assert(app.exitCode===null && i<100,'Native host failed to start');
  try{if((await fetch('http://127.0.0.1:47893/health')).status===401)break;}catch{}
  await Bun.sleep(100);
 }
 const token=(await readFile(resolve(root,'.local/workspace-token'),'utf8')).trim();
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:47893/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 async function call(name:string,params:any={}){
  const reply=await client.callTool({name,arguments:{params}});
  assert(!reply.isError,JSON.stringify(reply));
  return JSON.parse((reply.content as any[]).find(c=>c.type==='text').text);
 }
 let status:any;
 for(let i=0;i<100;i++){status=await call('engine_status');if(Array.isArray(status))break;await Bun.sleep(100);}
 assert(status.find((s:any)=>s.engine==='ladybird')?.available,JSON.stringify(status));
 const profiles=resolve(root,'.local/frames/ladybird');
 const baseline=new Set(await readdir(profiles));
 await call('project_register',{id:'isolated',name:'Same-origin pane isolation',sourceRoot:root,supportRoot:root,server:{command:['python3','-m','http.server','47894','--bind','127.0.0.1','--directory',directory],cwd:root,url:'http://127.0.0.1:47894'}});
 const panes=['first','second'].map((id,i)=>({id,name:id,engine:'ladybird',viewport:{width:400,height:300,deviceScaleFactor:1},position:{x:i*440,y:0},route:'/',conditions:{}}));
 for(const id of ['isolation','other'])await call('demo_put',{id,projectId:'isolated',name:id,description:'Same-origin isolation verification',panes});
 await call('selection_set',{projectId:'isolated',demoId:'isolation'});
 async function state(id:string){return JSON.parse((await call('pane_inspect',{paneId:id,selector:'#state'})).element.text)}
 const activeProfiles=(await readdir(profiles)).filter(name=>!baseline.has(name));
 assert.equal(activeProfiles.length,2,'Each pane needs its own profile directory');
 const empty={local:null,session:null,cookie:''};
 assert.deepEqual(await state('first'),empty);assert.deepEqual(await state('second'),empty);
 for(const action of ['down','up'])await call('pane_input',{paneId:'first',event:{type:'pointer',action,x:40,y:30,button:'left'}});
 const written=await state('first');assert.deepEqual(written,{local:'written',session:'written',cookie:'key=written'});
 assert.deepEqual(await state('second'),empty);
 const capture=await call('pane_capture',{paneId:'first'});
 await call('selection_set',{projectId:'isolated',demoId:'other'});
 assert.deepEqual(await state('first'),empty);assert.deepEqual(await state('second'),empty);
 await call('selection_set',{projectId:'isolated',demoId:'isolation'});
 assert.deepEqual(await state('first'),empty);assert.deepEqual(await state('second'),empty);
 await call('selection_set',{projectId:null,demoId:null});
 for(const profile of activeProfiles)assert(!(await readdir(profiles)).includes(profile),'Disposed profile remains');
 assert.deepEqual((await readdir(profiles)).sort(),[...baseline].sort(),'Session leaked profile directories');
 await writeFile(resolve(directory,'evidence.json'),JSON.stringify({status,written,capture,scope:'Real Qt MCP: same-origin Ladybird cookies/localStorage/sessionStorage isolated per pane and reset after demo switch/return'},null,2));
 await client.close();
 app.kill('SIGTERM');
 await app.exited;
 const errors=await readFile(resolve(directory,'host-errors.log'),'utf8');
 assert(!/free\(\):|ASSERTION FAILED|stack smashing|Segmentation fault/.test(errors),errors);
 console.log('PASS same-origin Ladybird pane storage isolation and demo reset:',directory);
} finally {await client.close();if(app.exitCode===null){app.kill('SIGTERM');await app.exited;}}
