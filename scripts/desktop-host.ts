import {writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {launch} from './runtime';
const [directory,port,run]=process.argv.slice(2);
async function report(name:string,value:unknown){const file=join(run,name);await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);}
try {
 const runtime=await launch({directory,port:Number(port)});
 console.error(`[${new Date().toISOString()}] Desktop ready; supervisor ${process.pid}, host ${runtime.host.pid}`);
 await report('startup.json',{url:runtime.url,pid:process.pid,directory});
 const code=await runtime.host.exited;
 const exit={time:new Date().toISOString(),code,signal:runtime.host.signalCode};
 console.error('Desktop host exited',JSON.stringify(exit));
 await report('exit.json',exit);
 await runtime.stop();process.exit(code);
} catch(error) {
 console.error(error);
 await report('startup.json',{error:error instanceof Error?error.message:String(error)});
 process.exit(1);
}
