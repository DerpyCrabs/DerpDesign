import { start } from '../../packages/workspace/src/main';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const directory=resolve(root,'.local/verification/native-'+randomUUID());
await mkdir(directory,{recursive:true});
const token=randomUUID(), desktopToken=randomUUID();
const {workspace,server}=await start({directory,port:0,token,desktopToken});
await workspace.call('project.register',{id:'popup-project',name:'Native UI test',sourceRoot:resolve(root,'tests/ladybird'),supportRoot:resolve(root,'tests/ladybird'),server:{command:['python3','-m','http.server','47932','--bind','127.0.0.1','--directory',resolve(root,'tests/ladybird')],cwd:root,url:'http://127.0.0.1:47932'}});
await workspace.call('demo.put',{id:'popup-demo',projectId:'popup-project',name:'Select popup test',description:'Real Qt/CEF mouse and persistence test',panes:[{id:'popup-pane',name:'Fixture',engine:'ladybird',viewport:{width:400,height:300,deviceScaleFactor:2},position:{x:0,y:0},route:'/select.html',conditions:{}}]});
const process=Bun.spawn([resolve(root,'build/desktop/desktop-native-tests'),'-input',resolve(root,'tests/desktop/popups')],{cwd:root,env:{...Bun.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_NATIVE_REAL:'1',DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_LADYBIRD_WORKER:resolve(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird')},stdout:'pipe',stderr:'pipe'});
const stdout=new Response(process.stdout).text(),stderr=new Response(process.stderr).text();
try {
 for(let i=0;!workspace.socket;i++){if(i>100||process.exitCode!==null)throw Error('Qt host did not connect: '+(process.exitCode!==null?(await stdout+'\n'+await stderr):''));await Bun.sleep(100);}
 await workspace.call('selection.set',{projectId:'popup-project',demoId:'popup-demo'});
 const code=await process.exited;
 const log=await stdout+'\n'+await stderr;
 await writeFile(resolve(directory,'native.log'),log);
 console.log(await stdout);
 if(code!==0)console.error((await stderr).slice(-3000));
 assert.equal(code,0,'Native Qt interaction failed');
 const state=JSON.parse(await readFile(resolve(directory,'state.json'),'utf8'));
 assert.equal(state.captures.length,2);
 const opened=JSON.parse(await readFile(state.captures[1].inspectionPath,'utf8'));
 assert(opened.selectPopup.visible);
 console.log('PASS real native Qt select popup pointer selection, keyboard selection, Escape, captured menu at DPR2:',directory);
} finally {if(process.exitCode===null)process.kill();await workspace.stop();server.stop(true);}
