import {start} from '../../packages/workspace/src/main';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..'),directory=resolve(root,'.local/verification/canvas-workflow-'+randomUUID());
await mkdir(directory,{recursive:true});
const token=randomUUID(),desktopToken=randomUUID();
const {workspace,server}=await start({directory,port:0,token,desktopToken});
const fixture=resolve(root,'tests/desktop/canvas-workflow');
const reservation=Bun.serve({port:0,fetch:()=>new Response('reserved')});
const port=reservation.port;reservation.stop(true);
const project={id:'canvas',name:'Canvas fixture',sourceRoot:fixture,supportRoot:fixture,server:{command:['python3','-m','http.server',String(port),'--bind','127.0.0.1','--directory',fixture],cwd:root,url:`http://127.0.0.1:${port}`}};
const demo={id:'canvas-workflow',projectId:project.id,name:'Canvas controls',description:'Generic menu, styles and mixed viewport fixture',panes:['chromium','ladybird'].flatMap((engine,row)=>[
 {id:`canvas-${engine}-wide`,name:`${engine} / wide`,engine,viewport:{width:1000,height:800,deviceScaleFactor:'display'},position:{x:0,y:row*880},route:'/fixture.html',conditions:{}},
 {id:`canvas-${engine}-narrow`,name:`${engine} / narrow`,engine,viewport:{width:480,height:800,deviceScaleFactor:'display'},position:{x:1040,y:row*880},route:'/fixture.html',conditions:{}}
])};
await workspace.call('project.register',project);await workspace.call('demo.put',demo);
const proc=Bun.spawn([resolve(root,'build/desktop/desktop-native-tests'),'-input',resolve(root,'tests/desktop/canvas-workflow')],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_NATIVE_REAL:'1',DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_CHROMIUM_WORKER:resolve(root,'.local/engines/chromium/build/derp-chromium'),DERP_LADYBIRD_WORKER:resolve(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird')},stdout:Bun.file(resolve(directory,'stdout.log')),stderr:Bun.file(resolve(directory,'stderr.log'))});
const stdout=()=>readFile(resolve(directory,"stdout.log"),"utf8"),stderr=()=>readFile(resolve(directory,"stderr.log"),"utf8");
try {
 for(let n=0;!workspace.socket;n++){assert(n<100&&proc.exitCode===null,'Qt startup failed: '+(proc.exitCode!==null?await stderr():''));await Bun.sleep(100)}
 await workspace.call('selection.set',{projectId:project.id,demoId:demo.id});
 const code=await proc.exited;const out=await stdout(),err=await stderr();await writeFile(resolve(directory,'native.log'),out+'\n'+err);console.log(out);if(code)console.error(err.slice(-5000));
 assert.equal(code,0,'Canvas review workflow failed');
 assert(!/TypeError:|ReferenceError:|Binding loop|Cannot assign|Unable to assign/.test(err),'QML runtime warnings: '+err.slice(-5000));
 console.log('PASS generic fixture styles across both engines, overview, actual size, inspection, pan:',directory);
}finally{if(proc.exitCode===null)proc.kill();await workspace.stop();server.stop(true)}
