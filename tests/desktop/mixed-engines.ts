import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const directory=resolve(root,'.local/verification/mixed-'+randomUUID());
await mkdir(directory,{recursive:true});
const app=Bun.spawn(['bun','scripts/start.ts'],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_WORKSPACE_PORT:'47891',DERP_STATE_DIR:directory,DERP_SCREENSHOT:resolve(directory,'canvas.png'),DERP_SCREENSHOT_DELAY_MS:'15000'},stdout:Bun.file(resolve(directory,'host.log')),stderr:Bun.file(resolve(directory,'host-errors.log'))});
const client=new Client({name:'mixed-engine-verifier',version:'1'});
try {
 for(let i=0;;i++){
  assert(app.exitCode===null && i<100,'Native host failed to start');
  try{if((await fetch('http://127.0.0.1:47891/health')).status===401)break;}catch{}
  await Bun.sleep(100);
 }
 const token=(await readFile(resolve(root,'.local/workspace-token'),'utf8')).trim();
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:47891/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 async function call(name:string,params:any={}){
  const reply=await client.callTool({name,arguments:{params}});
  assert(!reply.isError,JSON.stringify(reply));
  return JSON.parse((reply.content as any[]).find(c=>c.type==='text').text);
 }
 let status:any;
 for(let i=0;i<100;i++){status=await call('engine_status');if(Array.isArray(status))break;await Bun.sleep(100);}
 for(const engine of ['chromium','ladybird'])assert(status.find((s:any)=>s.engine===engine)?.available,JSON.stringify(status));
 await call('project_register',{id:'mixed',name:'Real engine comparison',sourceRoot:resolve(root,'tests/chromium'),supportRoot:resolve(root,'tests/chromium'),server:{command:['python3','-m','http.server','47892','--bind','127.0.0.1','--directory',resolve(root,'tests/chromium')],cwd:root,url:'http://127.0.0.1:47892'}});
 const panes=['chromium','ladybird'].map((engine,i)=>({id:engine,name:engine==='chromium'?'Chromium / CEF':'Pristine upstream Ladybird',engine,viewport:{width:640,height:480,deviceScaleFactor:1},position:{x:i*680,y:0},route:'/fixture.html',conditions:{}}));
 await call('demo_put',{id:'mixed-demo',projectId:'mixed',name:'Same fixture, two engines',description:'Live native surfaces from independent engines',panes});
 await call('selection_set',{projectId:'mixed',demoId:'mixed-demo'});
 const captures=[];
 for(const engine of ['chromium','ladybird']){
  const before=await call('pane_inspect',{paneId:engine,selector:'button'});
  assert.equal(before.element.text,'0');
  for(const action of ['down','up'])await call('pane_input',{paneId:engine,event:{type:'pointer',action,x:40.5,y:28.5,button:'left'}});
  const after=await call('pane_inspect',{paneId:engine,point:{x:40.5,y:28.5}});
  assert.equal(after.element.text,'1');
  assert(after.computedStyles && after.dom);
  const capture=await call('pane_capture',{paneId:engine});
  assert.equal(capture.engine,engine);assert.equal(capture.viewport.width,640);
  const png=await readFile(capture.screenshotPath);
  assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),480);
  captures.push(capture);
 }
 await writeFile(resolve(directory,'evidence.json'),JSON.stringify({status,captures,scope:'Mixed real native rendering, MCP pointer input, selector/point DOM/CSS inspection and engine-routed captures'},null,2));
 await client.close();
 assert.equal(await app.exited,0,'Native host shutdown failed');
 const errors=await readFile(resolve(directory,'host-errors.log'),'utf8');
 assert(!/free\(\):|ASSERTION FAILED|stack smashing|Segmentation fault/.test(errors),errors);
 console.log('PASS mixed CEF/upstream Ladybird native canvas and engine-routed captures:',directory);
} finally {await client.close();if(app.exitCode===null){app.kill('SIGTERM');await app.exited;}}
