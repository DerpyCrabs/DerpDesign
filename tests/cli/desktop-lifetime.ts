import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const directory=await mkdtemp(join(root,'.local/verification/desktop-lifetime-'));
const parentFile=join(directory,'parent.ts');
await writeFile(parentFile,`import {startDesktop} from ${JSON.stringify(join(root,'scripts/desktop-session.ts'))};\nconsole.log(JSON.stringify(await startDesktop({directory:${JSON.stringify(directory)},port:0})));\nsetInterval(()=>{},1000);`);
const parent=Bun.spawn([process.execPath,parentFile],{cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen'},stdout:'pipe',stderr:'pipe'});
const reader=parent.stdout.getReader();let output='';let desktop:{url:string;pid:number;log:string}|undefined;
try {
 while(!output.includes('\n')){const chunk=await reader.read();assert(!chunk.done,'parent exited before startup');output+=new TextDecoder().decode(chunk.value);}
 desktop=JSON.parse(output.split('\n')[0]);assert(desktop);
 const token=(await readFile(join(root,'.local/workspace-token'),'utf8')).trim();
 const health=()=>fetch(new URL('/health',desktop!.url),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});
 assert((await health()).ok);
 parent.kill('SIGTERM');await parent.exited;
 assert((await health()).ok,'desktop must survive parent termination');
 process.kill(desktop.pid,0);
 assert((await readFile(desktop.log,'utf8')).includes('Desktop ready'));
 // Reopening through the CLI must use this same service and return promptly.
 const cli=Bun.spawn([process.execPath,'scripts/cli.ts','call','workspace_info','--url',desktop.url],{cwd:root,stdout:'pipe',stderr:'pipe'});
 const info=JSON.parse(await new Response(cli.stdout).text());assert.equal(await cli.exited,0);assert.equal(info.hostMode,'window');
 console.log('PASS desktop survives parent SIGTERM; service remains available; logs retained');
} finally {
 if(parent.exitCode===null)parent.kill('SIGTERM');
 if(desktop){process.kill(desktop.pid,'SIGTERM');for(let i=0;await Bun.file(join(directory,'runtime.lock')).exists()&&i<100;i++)await Bun.sleep(50);assert(!await Bun.file(join(directory,'runtime.lock')).exists(),'owned desktop stopped cleanly');}
}
