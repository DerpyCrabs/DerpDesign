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
let project={id:'canvas',name:'Canvas fixture',sourceRoot:fixture,supportRoot:fixture,server:{command:['python3','-m','http.server',String(port),'--bind','127.0.0.1','--directory',fixture],cwd:root,url:`http://127.0.0.1:${port}`}};
let demo={id:'canvas-workflow',projectId:project.id,name:'Canvas controls',description:'Generic menu, styles and mixed viewport fixture',panes:['chromium','ladybird'].flatMap((engine,row)=>[
 {id:`canvas-${engine}-wide`,name:`${engine} / wide`,engine,viewport:{width:1000,height:800,deviceScaleFactor:'display'},position:{x:0,y:row*880},route:'/fixture.html',conditions:{}},
 {id:`canvas-${engine}-narrow`,name:`${engine} / narrow`,engine,viewport:{width:480,height:800,deviceScaleFactor:'display'},position:{x:1040,y:row*880},route:'/fixture.html',conditions:{}}
])};
const gpu = process.argv.includes('--gpu');
if (gpu && process.env.DERP_TELEVECHA_CATALOG) {
 const catalog = JSON.parse(await readFile(process.env.DERP_TELEVECHA_CATALOG, 'utf8'));
 demo = catalog.demos.find((entry: {id:string}) => entry.id === 'televecha-message-gallery');
 assert(demo, 'Missing TeleVecha gallery demo');
 project = catalog.projects.find((entry: {id:string}) => entry.id === demo.projectId);
 assert(project, 'Missing gallery project');
 const args = project.server.command;
 const index = args.indexOf('--port');
 assert(index >= 0 && index + 1 < args.length, 'Expected a Vite --port argument');
 args[index + 1] = String(port);
 project.server.url = 'http://127.0.0.1:' + port;
}
await workspace.call('project.register',project);await workspace.call('demo.put',demo);
const readyFile = resolve(directory, 'content-ready');
if (gpu) assert(process.env.DERP_GPU_RUNTIME && process.env.DERP_GPU_RUNTIME === process.env.XDG_RUNTIME_DIR
 && !process.env.DISPLAY, 'GPU tests require the private headless-gpu.py compositor');
const rendererEnv = gpu ? { DERP_READY_FILE: readyFile, QSG_RHI_PROFILE:"1" } :
 { QT_QPA_PLATFORM:'offscreen', QT_QUICK_BACKEND:'software' };
const proc=Bun.spawn([resolve(root,'build/desktop/desktop-native-tests'),'-input',resolve(root, gpu ? 'tests/desktop/canvas-gpu' : 'tests/desktop/canvas-workflow')],{cwd:root,env:{...process.env,...rendererEnv,DERP_NATIVE_REAL:'1',DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${server.port}`,DERP_CHROMIUM_WORKER:resolve(root,'.local/engines/chromium/build/derp-chromium'),DERP_LADYBIRD_WORKER:resolve(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird')},stdout:Bun.file(resolve(directory,'stdout.log')),stderr:Bun.file(resolve(directory,'stderr.log'))});
const stdout=()=>readFile(resolve(directory,"stdout.log"),"utf8"),stderr=()=>readFile(resolve(directory,"stderr.log"),"utf8");
try {
 for(let n=0;!workspace.socket;n++){assert(n<100&&proc.exitCode===null,'Qt startup failed: '+(proc.exitCode!==null?await stderr():''));await Bun.sleep(100)}
 const startMs = performance.now();
 await workspace.call('selection.set',{projectId:project.id,demoId:demo.id});
 if (gpu) {
   const panels: Record<string,string> = {arrivals:'#receive-update:not([hidden])',
     expressions:'.expression-picker', attach:'.composer-attach-menu', chat:'.chat-context-menu',
     main:'.sidebar-main-menu:popover-open', settings:'.settings-dialog'};
   for (const pane of demo.panes) {
     const conditions = pane.conditions as {panel?:string, message?:number};
     const selector = process.env.DERP_TELEVECHA_CATALOG
       ? panels[conditions.panel ?? ''] ?? '.conversation-ready article[data-message-id]'
       : '.navigation';
     for (;;) {
       try {
         await workspace.call('pane.inspect', {paneId:pane.id, selector, geometryOnly:true});
         break;
       } catch (error) {
         if (performance.now() - startMs > 90000 || proc.exitCode !== null) throw error;
         await Bun.sleep(150);
       }
     }
   }
   const startupMs = Math.round(performance.now() - startMs);
   console.log('CANVAS_STARTUP', JSON.stringify({demo:demo.id, panes:demo.panes.length, startupMs}));
   await writeFile(readyFile, String(startupMs));
 }
 const code=await proc.exited;const out=await stdout(),err=await stderr();await writeFile(resolve(directory,'native.log'),out+'\n'+err);console.log(out);if(code)console.error(err.slice(-5000));
 if (gpu) {
   const phases = out.split('\n').filter(line => line.includes('GPU_PHASE ')).map(line => JSON.parse(line.split('GPU_PHASE ')[1]));
   await writeFile(resolve(directory,'performance.json'), JSON.stringify({demo:demo.id, panes:demo.panes.length,
     startupMs:Number(await readFile(readyFile,'utf8')), phases}, null, 2));
   const report = resolve(directory,'performance.json');
   console.log('Performance report', report);
   for (const phase of phases.filter(phase => phase.device)) {
     assert(phase.fps >= phase.refreshHz * 0.8 && phase.p95Ms <= 2000 / phase.refreshHz,
       phase.phase + ' missed frame pacing budget. See ' + report);
   }
   const baselineDir = process.env.DERP_PERF_BASELINES;
   if (baselineDir && code === 0) {
     const baseline = resolve(baselineDir, demo.id + '-' + (process.env.QT_SCALE_FACTOR || '1') + '.json');
     const comparison = Bun.spawn(['python3','tests/performance/compare.py',baseline,report], {stdout:'inherit',stderr:'inherit'});
     assert.equal(await comparison.exited, 0, 'Performance baseline comparison failed');
   }
   assert(Number(await readFile(readyFile,'utf8')) <= (process.env.DERP_TELEVECHA_CATALOG ? 30000 : 10000),
     'Startup budget exceeded');
 }
 assert.equal(code,0,'Canvas review workflow failed');
 assert(!/TypeError:|ReferenceError:|Binding loop|Cannot assign|Unable to assign/.test(err),'QML runtime warnings: '+err.slice(-5000));
 console.log('PASS', demo.name, directory);
}finally{if(proc.exitCode===null)proc.kill();await workspace.stop();server.stop(true)}
