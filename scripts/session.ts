import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,open,unlink,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {dataRoot,hostArgument,root,launch} from './runtime';
import {randomBytes} from 'node:crypto';

export interface SessionRecord {version:1;url:string;directory:string;controlUrl:string;secret:string;pid:number;log:string}
export async function readSession(file:string):Promise<SessionRecord>{
 const record=JSON.parse(await readFile(resolve(file),'utf8'));
 if(record.version!==1||typeof record.secret!=='string'||!record.directory)throw Error('Invalid session file');
 for(const url of [record.url,record.controlUrl]){const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1')throw Error('Session endpoints must be local');}
 return record;
}
export async function sessionControl(file:string,action:'status'|'stop'){
 const record=await readSession(file);
 const response=await fetch(new URL(action,record.controlUrl),{method:action==='stop'?'POST':'GET',headers:{Authorization:`Bearer ${record.secret}`},signal:AbortSignal.timeout(action==='stop'?30000:3000)}).catch(()=>{throw Error(`Session is unreachable; inspect ${record.log}. No process was restarted or killed.`)});
 if(!response.ok)throw Error(`Session ${action} failed (${response.status})`);
 return response.json();
}
export async function startSession(options:{directory?:string;scale?:number;port?:number}){
 if(options.scale!==undefined&&(!Number.isFinite(options.scale)||options.scale<=0))throw Error('Scale must be positive');
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<0||options.port>65535))throw Error('Port must be an integer from 0 to 65535');
 await mkdir(join(dataRoot,'sessions'),{recursive:true});
 const directory=options.directory?resolve(options.directory):await mkdtemp(join(dataRoot,'sessions/session-'));
 await mkdir(directory,{recursive:true,mode:0o700});
 if(await realpath(directory)===await realpath(join(dataRoot,'workspace')).catch(()=>join(dataRoot,'workspace')))throw Error('Persistent headless sessions cannot use the desktop state directory');
 const file=join(directory,'session.json'),pending=join(directory,'session-start.lock'),log=join(directory,'session.log');
 if(await Bun.file(file).exists())throw Error(`Session record already exists: ${file}. Use session status/stop; do not replace it.`);
 const lock=await open(pending,'wx');await lock.close();
 const output=await open(log,'a',0o600);
 let child:ReturnType<typeof spawn>|undefined;
 try{
  child=spawn(process.execPath,[hostArgument('session'),directory,String(options.scale??1),String(options.port??0)],{cwd:root,detached:true,stdio:['ignore',output.fd,output.fd],env:process.env});
  let error:Error|undefined;child.on('error',e=>{error=e});child.unref();
  const deadline=Date.now()+20000;
  while(!await Bun.file(file).exists()){
   if(error)throw error;if(child.exitCode!==null||child.signalCode!==null||Date.now()>deadline)throw Error(`Headless session failed to start; inspect ${log}`);
   await Bun.sleep(50);
  }
  const record=await readSession(file);await sessionControl(file,'status');
  return {session:file,url:record.url,directory,log};
 }catch(e){child?.kill('SIGTERM');throw e}finally{await output.close();await unlink(pending).catch(()=>{});}
}
export async function hostSession(directory:string,scale:number,port:number){
 const runtime=await launch({headless:true,directory,scale,port});
 const file=join(directory,'session.json'),secret=randomBytes(32).toString('hex');
 let stopping:Promise<void>|undefined;
 const stop=()=>stopping??=(async()=>{await runtime.stop();await unlink(file).catch(()=>{});control.stop();})();
 const control=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  if(req.headers.get('Authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401});
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/status')return Response.json({status:'running',url:runtime.url,directory,pid:process.pid});
  if(req.method==='POST'&&path==='/stop'){await stop();return Response.json({status:'stopped',directory});}
  return new Response('Not found',{status:404});
 }});
 await writeFile(file,JSON.stringify({version:1,url:runtime.url,directory,controlUrl:`http://127.0.0.1:${control.port}/`,secret,pid:process.pid,log:join(directory,'session.log')} satisfies SessionRecord),{mode:0o600,flag:'wx'});
 void runtime.host.exited.then(()=>stop());
}
