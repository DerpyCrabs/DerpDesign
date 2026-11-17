import {fixture} from './fixture';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..');
const directory=await mkdtemp(join(root,'.local/verification/session-sequence-'));
async function cli(args:string[],ok=true){const p=Bun.spawn([process.execPath,'scripts/cli.ts',...args],{cwd:root,stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);assert.equal(code,ok?0:1,err||out);return out;}
const started=JSON.parse(await cli(['session','start','--state-dir',directory]));const session=started.session;
async function call(name:string,params:any={}){const file=join(directory,'params.json');await writeFile(file,JSON.stringify(params));return JSON.parse(await cli(['call',name,'--session',session,'--file',file]));}
try{
 assert.equal(JSON.parse(await cli(['session','status','--session',session])).status,'running');
 assert.equal((await call('workspace_info')).hostMode,'headless');
 await cli(['session','start','--state-dir',directory],false);
 // Acquire a currently free project port without assuming a user's service is absent.
 const reservation=Bun.serve({port:0,fetch:()=>new Response()});const port=reservation.port!;reservation.stop(true);
 const {project,demo}=fixture(root,port);project.id='sequence-test';demo.projectId=project.id;
 await call('project_register',project);await call('demo_put',demo);await call('selection_set',{projectId:project.id,demoId:demo.id});
 await cli(['open','--session',session,'--project',project.id,'--demo',demo.id],false);assert.equal((await call('workspace_info')).hostMode,'headless');
 for(const pane of demo.panes){
  const sequence=join(directory,'sequence.json'),report=join(directory,`${pane.id}-report.json`);
  await writeFile(sequence,JSON.stringify({steps:[{action:'click',selector:'#counter'},{action:'assert',selector:'#counter',text:'1'},{action:'type',selector:'#notes',text:'hello'},{action:'assert',selector:'#echo',text:'hello'},{action:'drag',from:{selector:'#drag'},to:{selector:'#drop'}},{action:'assert',selector:'#drop',text:'Dropped'},{action:'capture',label:'interactions'}]}));
  const passed=JSON.parse(await cli(['sequence','--session',session,'--pane',pane.id,'--file',sequence,'--out',report]));assert.equal(passed.status,'passed');assert.equal(passed.captures.length,3);assert.equal(JSON.parse(await readFile(report,'utf8')).captures[1].label,'interactions');
  await writeFile(sequence,JSON.stringify({steps:[{action:'assert',selector:'#counter',text:'wrong',timeoutMs:0}]}));
  const failed=JSON.parse(await cli(['sequence','--session',session,'--pane',pane.id,'--file',sequence],false));assert.equal(failed.status,'failed');assert(failed.failureCapture.id);assert.match(failed.error,/Step 1/);
  console.log('PASS',pane.engine,'sequence and failure evidence');
 }
 console.log('PASS persistent session survives CLI exits, duplicate start refused');
}finally{await cli(['session','stop','--session',session]);}
assert(!await Bun.file(session).exists());assert(!await Bun.file(join(directory,'runtime.lock')).exists());
console.log('PASS owned session shutdown',directory);
