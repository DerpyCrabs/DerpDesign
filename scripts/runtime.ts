import {mkdir,readFile,writeFile,chmod,unlink,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {start} from '../packages/workspace/src/main';
export const root=resolve(import.meta.dir,'..');
export async function credential(){
 const path=join(root,'.local/workspace-token');await mkdir(join(root,'.local'),{recursive:true,mode:0o700});
 try{await writeFile(path,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})}catch(e:any){if(e.code!=='EEXIST')throw e}
 await chmod(path,0o600);return (await readFile(path,'utf8')).trim();
}
export async function launch(options:{headless?:boolean,restoreDesktop?:boolean,scale?:number,port?:number,directory?:string}={}){
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<0||options.port>65535))throw Error('Port must be an integer from 0 to 65535');
 const scale=options.scale??1;if(!Number.isFinite(scale)||scale<=0)throw Error('Scale must be positive');
 const directory=resolve(options.directory??process.env.DERP_STATE_DIR??join(root,options.headless?'.local/headless':'.local/workspace'));
 await mkdir(directory,{recursive:true});
 const lock=join(directory,'runtime.lock');
 try{const f=await open(lock,'wx');await f.writeFile(String(process.pid));await f.close()}catch(e:any){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lock,'utf8'));let alive=true;try{process.kill(pid,0)}catch(err:any){if(err.code==='ESRCH')alive=false;else throw err}if(alive)throw Error('Workspace is already owned by process '+pid);await unlink(lock);return launch(options)}
 let service:any,host:any,closing:Promise<void>|undefined;
 async function stop(){return closing??=(async()=>{try{if(host&&host.exitCode===null){host.kill('SIGTERM');await host.exited}if(service)await service.workspace.stop()}finally{service?.server.stop(true);await unlink(lock).catch(()=>{})}})()}
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{console.error(`[${new Date().toISOString()}] DerpDesign supervisor ${process.pid} received ${signal}; stopping owned host`);void stop().then(()=>process.exit(signal==='SIGINT'?130:143))});
 try{
  // A separate headless workspace starts with the existing catalog, never shares mutable state.
  if(options.headless&&!await Bun.file(join(directory,'state.json')).exists()){
   try{const saved=JSON.parse(await readFile(join(root,'.local/workspace/state.json'),'utf8'));await writeFile(join(directory,'state.json'),JSON.stringify({projects:saved.projects,demos:saved.demos,captures:[],selection:{generation:0}}))}catch(e:any){if(e.code!=='ENOENT')throw e}
  }
  const token=await credential();const desktopToken=randomBytes(32).toString('hex');service=await start({token,desktopToken,directory,restoreDesktop:!options.headless && (options.restoreDesktop ?? true),port:options.port??Number(process.env.DERP_WORKSPACE_PORT??(options.headless?0:47831))});
  service.workspace.hostMode=options.headless?'headless':'window';
  const executable=join(root,'build/desktop/derpdesign');if(!await Bun.file(executable).exists())throw Error('Build desktop first: bun run desktop:build');
  const env={...process.env,DERP_CANVAS_SETTINGS:options.headless ? "" : join(directory,"canvas.ini"),DERP_DESKTOP_TOKEN:desktopToken,DERP_WORKSPACE_URL:`http://127.0.0.1:${service.server.port}`,DERP_CHROMIUM_WORKER:process.env.DERP_CHROMIUM_WORKER??join(root,'.local/engines/chromium/build/derp-chromium'),DERP_LADYBIRD_WORKER:process.env.DERP_LADYBIRD_WORKER??join(root,'.local/engines/ladybird/build-upstream/bin/derp-ladybird'),...(options.headless?{DERP_HEADLESS:'1',QT_QPA_PLATFORM:'offscreen',QT_SCALE_FACTOR:String(scale)}:{})};
  host=Bun.spawn([executable,...(options.headless?['--headless']:[])],{cwd:root,env,stdin:'ignore',stdout:Bun.stderr,stderr:'inherit'});
  for(let i=0;!service.workspace.socket;i++){if(host.exitCode!==null||i>200)throw Error('Engine host failed to connect');await Bun.sleep(50)}
  return {url:`http://127.0.0.1:${service.server.port}/mcp`,token,host,workspace:service.workspace,stop};
 }catch(e){await stop();throw e}
}
