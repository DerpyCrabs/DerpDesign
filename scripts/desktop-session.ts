import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {root} from './runtime';

/** The visible app owns its lifetime; a CLI/agent command only starts it. */
export async function startDesktop(options:{directory?:string;port?:number}={}) {
 const directory=resolve(options.directory??process.env.DERP_STATE_DIR??join(root,'.local/workspace'));
 const logs=join(root,'.local/desktop');await mkdir(logs,{recursive:true});
 const run=await mkdtemp(join(logs,'run-'));
 const resultFile=join(run,'startup.json'),log=join(run,'desktop.log');
 const output=await open(log,'a',0o600);
 const child=spawn(process.execPath,[join(root,'scripts/desktop-host.ts'),directory,String(options.port??Number(process.env.DERP_WORKSPACE_PORT??47831)),run],{cwd:root,detached:true,stdio:['ignore',output.fd,output.fd],env:process.env});
 await output.close();
 let spawnError:Error|undefined;child.on('error',error=>{spawnError=error});child.unref();
 try {
  const deadline=Date.now()+20000;
  while(!await Bun.file(resultFile).exists()) {
   if(spawnError)throw spawnError;
   if(child.exitCode!==null||child.signalCode!==null||Date.now()>deadline)throw Error('Desktop failed to start');
   await Bun.sleep(50);
  }
  const result=await Bun.file(resultFile).json();
  if(result.error)throw Error(result.error);
  return {...result,log} as {url:string;pid:number;directory:string;log:string};
 } catch(error) {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  throw Error(`${error instanceof Error?error.message:String(error)}. Inspect ${log}`);
 }
}
