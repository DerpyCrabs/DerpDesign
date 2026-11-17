import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const count=Number(process.env.DERP_TEST_PANES??50);
const directory=resolve(root,'.local/verification/many-panes-'+randomUUID());
await mkdir(directory,{recursive:true});
const started=Date.now();
const app=Bun.spawn(['bun','scripts/start.ts'],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_WORKSPACE_PORT:'47881',DERP_STATE_DIR:directory,DERP_ENGINE_TIMEOUT_MS:'120000'},stdout:Bun.file(resolve(directory,'host.log')),stderr:Bun.file(resolve(directory,'host-errors.log'))});
const client=new Client({name:'many-panes-verifier',version:'1'});
try {
 for(let i=0;;i++){
  assert(app.exitCode===null && i<100,'Native host failed to start');
  try{if((await fetch('http://127.0.0.1:47881/health')).status===401)break;}catch{}
  await Bun.sleep(100);
 }
 const token=(await readFile(resolve(root,'.local/workspace-token'),'utf8')).trim();
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:47881/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 async function call(name:string,params:any={}){
  const reply=await client.callTool({name,arguments:{params}},undefined,{timeout:180000});
  assert(!reply.isError,JSON.stringify(reply));
  return JSON.parse((reply.content as any[]).find(c=>c.type==='text').text);
 }
 await call('project_register',{id:'many',name:'Many real panes',sourceRoot:resolve(root,'tests/chromium'),supportRoot:resolve(root,'tests/chromium'),server:{command:['python3','-m','http.server','47882','--bind','127.0.0.1','--directory',resolve(root,'tests/chromium')],cwd:root,url:'http://127.0.0.1:47882'}});
 const panes=Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Pane ${i+1}`,engine:'chromium',viewport:{width:240,height:180,deviceScaleFactor:1},position:{x:(i%10)*270,y:Math.floor(i/10)*240},route:'/fixture.html',conditions:{}}));
 await call('demo_put',{id:'many-demo',projectId:'many',name:`${count} live panes`,description:'No count-based suspension',panes});
 await call('demo_put',{id:'other-demo',projectId:'many',name:'Other demo',description:'Selection lifecycle fixture',panes:[{...panes[0],id:'other'}]});
 for(let i=0;i<100;i++){if(Array.isArray(await call('engine_status')))break;await Bun.sleep(100);}
 await call('selection_set',{projectId:'many',demoId:'many-demo'});
 console.log(`Opened ${count} panes in ${((Date.now()-started)/1000).toFixed(1)}s`);
 const captures=[];
 for(let i=0;i<count;i++){
  const paneId=`p${i}`;
  for(const action of ['down','up'])await call('pane_input',{paneId,event:{type:'pointer',action,x:40,y:28,button:'left'}});
  const inspection=await call('pane_inspect',{paneId,selector:'button'});
  assert.equal(inspection.element.text,'1',paneId);
  captures.push(await call('pane_capture',{paneId}));
  if((i+1)%10===0)console.log(`Verified live input, DOM and PNG in ${i+1}/${count} panes`);
 }
 await call('selection_set',{projectId:'many',demoId:'other-demo'});
 assert.equal((await call('pane_inspect',{paneId:'other',selector:'button'})).element.text,'0');
 await call('selection_set',{projectId:'many',demoId:'many-demo'});
 for(const paneId of ['p0',`p${count-1}`])assert.equal((await call('pane_inspect',{paneId,selector:'button'})).element.text,'0','Demo must reset on return');
 await call('selection_set',{projectId:null,demoId:null});
 await writeFile(resolve(directory,'evidence.json'),JSON.stringify({count,elapsedMs:Date.now()-started,captures,verified:'every pane clicked, inspected and captured; switched away/back and reset'},null,2));
 console.log('PASS real MCP/Qt/CEF many-pane lifecycle:',directory);
} finally {await client.close();app.kill('SIGTERM');await app.exited;}
