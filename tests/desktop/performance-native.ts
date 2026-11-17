import {start} from '../../packages/workspace/src/main';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const timeout=Number(process.env.DERP_NATIVE_SUITE_TIMEOUT_MS??180000);
assert(Number.isSafeInteger(timeout)&&timeout>0,'Invalid DERP_NATIVE_SUITE_TIMEOUT_MS');
if(!process.env.DERP_NATIVE_PERFORMANCE_WORKER){
 const supervisor=Bun.spawn(['python3',resolve(root,'tests/performance/supervise.py'),String(timeout),process.execPath,import.meta.path],{env:{...process.env,DERP_NATIVE_PERFORMANCE_WORKER:'1'},stdout:'inherit',stderr:'inherit'});
 process.exit(await supervisor.exited);
}
const directory=resolve(root,'.local/verification/performance-native-'+randomUUID());
await mkdir(directory,{recursive:true});
const reservation=Bun.serve({port:0,fetch:()=>new Response('reserved')});
const port=reservation.port;reservation.stop(true);
const token=randomUUID(),desktopToken=randomUUID();
const {workspace,server}=await start({directory,port:0,token,desktopToken});
const project={id:'inspector',name:'Pointer verification',sourceRoot:resolve(root,'tests/desktop/hover-live'),supportRoot:resolve(root,'tests/desktop/hover-live'),server:{command:['python3','-m','http.server',String(port),'--bind','127.0.0.1','--directory',resolve(root,'tests/desktop/hover-live')],cwd:root,url:`http://127.0.0.1:${port}`}};
const demo={id:'hover-live',projectId:'inspector',name:'Pointer ownership',description:'Pointer ownership and diagnostics',panes:['chromium','ladybird'].map((engine,index)=>({id:'inspect-'+engine,name:engine,engine,viewport:{width:800,height:600,deviceScaleFactor:'display'},position:{x:index*840,y:0},route:'/fixture.html',conditions:{}}))};
await workspace.call('project.register',project);await workspace.call('demo.put',{...demo,description:demo.description??'Native performance regression'});
const proc=Bun.spawn([resolve(root,'build/desktop/desktop-native-tests'),'-input',resolve(root,'tests/desktop/performance-native','tst_performance.qml')],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',QT_SCALE_FACTOR:'1.6',DERP_NATIVE_REAL:'1',DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_CHROMIUM_WORKER:resolve(root,'.local/engines/chromium/build/derp-chromium'),DERP_LADYBIRD_WORKER:resolve(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird')},stdout:Bun.file(resolve(directory,'stdout.log')),stderr:Bun.file(resolve(directory,'stderr.log'))});
try {
 for(let n=0;!workspace.socket;n++){assert(n<100&&proc.exitCode===null,'Qt startup failed');await Bun.sleep(100)}
 await workspace.call('selection.set',{projectId:project.id,demoId:demo.id});
 const code=await proc.exited,out=await readFile(resolve(directory,'stdout.log'),'utf8'),err=await readFile(resolve(directory,'stderr.log'),'utf8');
 await writeFile(resolve(directory,'native.log'),out+'\n'+err);console.log(out);if(code)console.log(err.slice(-6000));
 assert.equal(code,0,'Native pointer regression failed');assert(!/TypeError:|ReferenceError:|Binding loop|Cannot assign|Unable to assign/.test(err),err);
 console.log('PASS real Chromium and Ladybird pointer enter/leave and mode transitions:',directory);
}finally{if(proc.exitCode===null)proc.kill();await workspace.stop();server.stop(true)}
