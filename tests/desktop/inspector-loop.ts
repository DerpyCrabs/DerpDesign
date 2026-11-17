import { start, Workspace } from '../../packages/workspace/src/main';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const directory=resolve(root,'.local/verification/native-'+randomUUID());
await mkdir(directory,{recursive:true});
const fixtureRoot=resolve(directory,'fixture');
await mkdir(fixtureRoot);
const portServer=Bun.serve({port:0,fetch:req=>new Response(`<!doctype html><style>body{background:white}button{width:200px;height:40px;background:#ddf}</style><button id=anchor>${new URL(req.url).pathname.slice(1)}</button>`,{headers:{'content-type':'text/html'}})});
const token=randomUUID(), desktopToken=randomUUID();
const {workspace,server}=await start({directory,port:0,token,desktopToken});
await workspace.call('project.register',{id:'ui-project',name:'Native element test',sourceRoot:fixtureRoot,supportRoot:fixtureRoot,server:{command:['sleep','3600'],cwd:root,url:`http://127.0.0.1:${portServer.port}`}});
const pane=(id:string,route:string,x=0)=>({id,name:id,engine:'chromium',viewport:{width:400,height:400,deviceScaleFactor:1},position:{x,y:0},route,conditions:{}});
await workspace.call('demo.put',{id:'ui-demo',projectId:'ui-project',name:'First demo',description:'Inspector context test',panes:[pane('a','/Alpha'),pane('b','/Beta',450)]});
await workspace.call('demo.put',{id:'second-demo',projectId:'ui-project',name:'Second demo',description:'Switch demo',panes:[pane('b','/Gamma')]});
await workspace.call('project.register',{id:'other-project',name:'Other project',sourceRoot:fixtureRoot,supportRoot:fixtureRoot,server:{command:['sleep','3600'],cwd:root,url:`http://127.0.0.1:${portServer.port}`}});
await workspace.call('demo.put',{id:'other-demo',projectId:'other-project',name:'Other demo',description:'Switch project',panes:[pane('d','/Delta')]});
const process=Bun.spawn([resolve(root,'build/desktop/desktop-native-tests'),'-input',resolve(root,'tests/desktop/inspector')],{cwd:root,env:{...Bun.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_NATIVE_REAL:'1',DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_CHROMIUM_WORKER:resolve(root,'.local/engines/chromium/build/derp-chromium')},stdout:'pipe',stderr:'pipe'});
const stdout=new Response(process.stdout).text(),stderr=new Response(process.stderr).text();
try {
 for(let i=0;!workspace.socket;i++){if(i>100||process.exitCode!==null)throw Error('Qt host did not connect: '+(process.exitCode!==null?(await stdout+'\n'+await stderr):''));await Bun.sleep(100);}
 await workspace.call('selection.set',{projectId:'ui-project',demoId:'ui-demo'});
 const code=await process.exited;
 const log=await stdout+'\n'+await stderr;
 await writeFile(resolve(directory,'native.log'),log);
 console.log(log);
 assert.equal(code,0,'Native Qt interaction failed');
 const state=JSON.parse(await readFile(resolve(directory,'state.json'),'utf8'));
 assert.equal(state.selection.demoId,'other-demo');
 console.log('PASS native pane/demo/project switching clears inspector');
} finally {if(process.exitCode===null)process.kill();await workspace.stop();server.stop(true);portServer.stop(true);}
