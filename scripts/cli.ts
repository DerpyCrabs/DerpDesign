import {parseArgs} from 'node:util';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {launch,credential} from './runtime';
import {startDesktop} from './desktop-session';
import {startSession,sessionControl,readSession} from './session';
import {runSequence,sequenceSchema} from '../packages/automation/src/sequence';
import {serveProxy} from '../packages/workspace/src/stdio';
const {values:v,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{session:{type:'string'},project:{type:'string'},demo:{type:'string'},pane:{type:'string'},out:{type:'string'},selector:{type:'string'},point:{type:'string'},'frame-path':{type:'string'},properties:{type:'string'},url:{type:'string'},'state-dir':{type:'string'},port:{type:'string'},scale:{type:'string'},headless:{type:'boolean'},file:{type:'string'},help:{type:'boolean'}}});
const command=positionals[0];
if(v.help||!command){console.log(`derpdesign session start [--state-dir DIRECTORY] [--scale 1.6]
derpdesign session status|stop --session FILE
derpdesign sequence --session FILE --pane ID --file steps.json [--out report.json]
derpdesign open --project ID --demo ID [--pane ID]
derpdesign screenshot --pane ID --out file.png
derpdesign inspect --pane ID [--selector CSS | --point X,Y] [--frame-path JSON] [--properties color,width]
derpdesign snapshot [--project ID --demo ID] --out DIRECTORY
derpdesign call TOOL [--file params.json]
derpdesign mcp --headless [--scale 1.6] [--state-dir DIRECTORY] [--project ID --demo ID]
Connections: --url http://127.0.0.1:47831/mcp. open starts a host if absent; an existing window keeps its focus and canvas position. Other commands connect to a running host.
Headless MCP owns an isolated persistent workspace (.local/headless by default), seeded from the desktop catalog on first use.`);process.exit(0)}
if(command==='session'){
 try{const action=positionals[1];if(action==='start'){if(v.url||v.session||v.project||v.demo)throw Error('session start creates an isolated host; select a demo afterwards');console.log(JSON.stringify(await startSession({directory:v['state-dir'],scale:v.scale?Number(v.scale):undefined,port:v.port?Number(v.port):undefined}),null,2));}else if((action==='status'||action==='stop')&&v.session){console.log(JSON.stringify(await sessionControl(v.session,action),null,2));}else throw Error('Use session start, or session status|stop --session FILE');}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
 process.exit(process.exitCode??0);
}
if(v.session&&(v.url||v.port||v.headless))throw Error('--session cannot be combined with --url, --port, or --headless');
if(command==='sequence'&&!v.file)throw Error('sequence requires --file');
const sequence=command==='sequence'?sequenceSchema.parse(await Bun.file(v.file!).json()):undefined;
if(!['sequence','open','screenshot','inspect','snapshot','call','mcp'].includes(command))throw Error('Unknown command '+command);
if(v.project&&!v.demo)throw Error('--project requires --demo');
if(command==='open'&&(!v.project||!v.demo))throw Error('open requires --project and --demo');
if(['sequence','screenshot','inspect'].includes(command)&&!v.pane)throw Error('--pane is required');
if(['screenshot','snapshot'].includes(command)&&!v.out)throw Error('--out is required');
let owned:Awaited<ReturnType<typeof launch>>|undefined;
let startedDesktop=false;
const client=new Client({name:'derpdesign-cli',version:'1'});
let token=process.env.DERP_WORKSPACE_TOKEN??await credential(),url=v.url??process.env.DERP_WORKSPACE_MCP_URL??`http://127.0.0.1:${v.port??47831}/mcp`;
if(v.session){const session=await readSession(v.session);await sessionControl(v.session,'status');url=session.url;token=await credential();}
async function connect(){await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}))}
async function call(name:string,params:any={}):Promise<any>{const r=await client.callTool({name,arguments:{params}});const text=(r.content as any[]).find(c=>c.type==='text')?.text;if(r.isError){
 // Older running desktops reject active updates. Apply the same replacement
 // through their existing API without opening or activating the window.
 if(name==='demo_put'&&text?.includes('Deactivate demo before changing it')){
  const info=await call('workspace_info');
  if(info.selection.demoId!==params.id)throw Error(text);
  await call('selection_set',{projectId:null,demoId:null});
  try{const result=await call('demo_put',params);await call('selection_set',{projectId:params.projectId,demoId:params.id});return result;}
  catch(error){await call('selection_set',{projectId:info.selection.projectId,demoId:info.selection.demoId}).catch(()=>{});throw error;}
 }
 throw Error(text);
 }return JSON.parse(text)}
async function activate(){
 if(v.demo&&!v.project){const d=(await call('demo_list')).find((d:any)=>d.id===v.demo);if(!d)throw Error('Unknown demo '+v.demo);v.project=d.projectId;}
 if(v.demo){const d=(await call('demo_list')).find((d:any)=>d.id===v.demo&&d.projectId===v.project);if(!d)throw Error('Unknown project/demo');if(v.pane&&!d.panes.some((p:any)=>p.id===v.pane))throw Error('Pane is not in the requested demo');}
 const info=await call('workspace_info');
 if(v.project&&(info.selection.projectId!==v.project||info.selection.demoId!==v.demo))await call('selection_set',{projectId:v.project,demoId:v.demo});
 if(command==='open'&&startedDesktop){if(v.pane)await call('pane_focus',{paneId:v.pane});else await call('window_present');}
}
try{
 if(command==='mcp'&&v.headless){owned=await launch({headless:true,scale:Number(v.scale??1),directory:v['state-dir'],port:v.port?Number(v.port):undefined});url=owned.url;token=owned.token;}
 if(command==='open'){
  // Only a refused connection authorizes starting a new local host; auth/protocol errors do not.
  try{await fetch(new URL('/health',url),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2000)})}catch(e:any){if(v.session||v.url||process.env.DERP_WORKSPACE_MCP_URL||(e.code!=='ECONNREFUSED'&&e.cause?.code!=='ECONNREFUSED'))throw e;const desktop=await startDesktop({directory:v['state-dir'],port:v.port?Number(v.port):undefined});url=desktop.url;startedDesktop=true;}
 }
 await connect();
 if(command==='open'&&(await call('workspace_info')).hostMode==='headless')throw Error('The connected host has no window. Connect to a desktop host to focus its canvas.');
 if(v['state-dir']&&(await call('workspace_info')).directory!==resolve(v['state-dir']!))throw Error('The endpoint belongs to a different state directory; choose another --port or --url');
 await activate();
 if(command==='mcp'){
  await client.close();process.env.DERP_WORKSPACE_TOKEN=token;process.env.DERP_WORKSPACE_MCP_URL=url;
  let requestedStop=false;
  const proxy=await serveProxy(async()=>{requestedStop=true;await owned?.stop()});
  if(owned)void owned.host.exited.then(async()=>{if(!requestedStop){await proxy.close();process.exitCode=1;}});
 }else{
  if(command==='open')console.log(JSON.stringify(await call('workspace_info'),null,2));
  if(command==='inspect'){
   if(v.selector&&v.point)throw Error('Choose --selector or --point');
   let point;if(v.point){const xy=v.point.split(',').map(Number);if(xy.length!==2||xy.some(n=>!Number.isFinite(n)))throw Error('Point must be X,Y');point={x:xy[0],y:xy[1]}}
   const result=await call('pane_inspect',{paneId:v.pane,...(v.selector?{selector:v.selector}:{}),...(point?{point}:{}),...(v['frame-path']?{framePath:JSON.parse(v['frame-path'])}:{}),...(v.properties?{properties:v.properties.split(',')}: {})});
   if(v.out)await writeFile(resolve(v.out),JSON.stringify(result,null,2));else console.log(JSON.stringify(result,null,2));
  }
  if(command==='screenshot'){const capture=await call('pane_capture',{paneId:v.pane});await copyFile(capture.screenshotPath,resolve(v.out!));console.log(JSON.stringify({...capture,output:resolve(v.out!)},null,2));}
  if(command==='snapshot'){
   const info=await call('workspace_info'),demos=await call('demo_list'),demo=demos.find((d:any)=>d.id===info.selection.demoId);if(!demo)throw Error('No active demo');
   const projects=await call('project_list'),directory=resolve(v.out!);await mkdir(directory,{recursive:false});
   const captures=[];for(let i=0;i<demo.panes.length;i++){const pane=demo.panes[i],c=await call('pane_capture',{paneId:pane.id});const screenshot=`pane-${i+1}.png`,inspection=`pane-${i+1}.json`;await copyFile(c.screenshotPath,join(directory,screenshot));await copyFile(c.inspectionPath,join(directory,inspection));captures.push({...c,screenshotPath:screenshot,inspectionPath:inspection});}
   const after=await call('workspace_info');if(after.selection.generation!==info.selection.generation)throw Error('Demo changed during snapshot');
   if(new Set(captures.map(c=>c.sourceFingerprint+':'+c.harnessFingerprint)).size>1)throw Error('Sources changed during snapshot');
   await writeFile(join(directory,'snapshot.json'),JSON.stringify({project:projects.find((p:any)=>p.id===demo.projectId),demo,selection:info.selection,captures},null,2));console.log(directory);
  }
  if(command==='sequence'){const report=await runSequence(call,v.pane!,sequence);if(v.out)await writeFile(resolve(v.out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.status==='failed')process.exitCode=1;}
  if(command==='call'){if(!positionals[1])throw Error('call requires tool name');console.log(JSON.stringify(await call(positionals[1],v.file?await Bun.file(v.file).json():{}),null,2));}
  await client.close();if(owned){for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void owned?.stop()});await owned.host.exited;await owned.stop();}
 }
}catch(e){await client.close().catch(()=>{});await owned?.stop();console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
