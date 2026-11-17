import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const directory = await mkdtemp(tmpdir()+'/derp-metrics-');
const reservation = Bun.serve({port:0,fetch:()=>new Response('reserved')});
const fixturePort=reservation.port; reservation.stop(true);
const client = new Client({name:'metrics-test',version:'1'});
try {
 await client.connect(new StdioClientTransport({command:'bun',args:['scripts/cli.ts','mcp','--headless','--state-dir',directory]}));
 const call = async(name:string,params={}) => {
  const reply=await client.callTool({name,arguments:{params}});
  assert(!reply.isError,JSON.stringify(reply));
  return JSON.parse((reply.content as any[])[0].text);
 };
 const tools=await client.listTools();
 assert(tools.tools.some(t=>t.name==='performance_snapshot'));
 await call('project_register',{id:'metrics',name:'Metrics',sourceRoot:process.cwd(),supportRoot:process.cwd()+'/tests/chromium',server:{command:['python3','-m','http.server',String(fixturePort),'--bind','127.0.0.1','--directory',process.cwd()+'/tests/chromium'],cwd:process.cwd(),url:`http://127.0.0.1:${fixturePort}`}});
 await call('demo_put',{id:'metrics-demo',projectId:'metrics',name:'Metrics',description:'Metrics integration',panes:[{id:'metrics-pane',name:'Fixture',engine:'chromium',viewport:{width:800,height:600,deviceScaleFactor:1},position:{x:0,y:0},route:'/fixture.html',conditions:{}}]});
 await call('selection_set',{projectId:'metrics',demoId:'metrics-demo'});
 await call('pane_input',{paneId:'metrics-pane',event:{type:'pointer',action:'move',x:40,y:40}});
 let snapshot:any;
 for(let i=0;i<100;i++) {
  snapshot=await call('performance_snapshot');
  if(snapshot.panes['metrics-pane'].framesReceived>0)break;
  await Bun.sleep(50);
 }
 const metrics=snapshot.panes['metrics-pane'];
 assert(metrics.framesReceived>0);
 assert(metrics.frameBytes>0);
 assert(metrics.frameReadCopyMs>=0);
 assert(metrics.engineRequests>0);
 assert.match(snapshot.latencySemantics,/observational/);
 await call('selection_set',{projectId:null,demoId:null});
 assert.deepEqual((await call('performance_snapshot')).panes,{});
 console.log(JSON.stringify(snapshot));
} finally {
 await client.close();
 for(let i=0;;i++){
  const locked=await access(directory+'/runtime.lock').then(()=>true,()=>false);
  if(!locked)break;
  assert(i<200,'Owned runtime.lock remained after client.close');
  await Bun.sleep(50);
 }
 await rm(directory,{recursive:true,force:true});
}
