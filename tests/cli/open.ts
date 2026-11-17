import {fixture} from './fixture';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..'),directory=resolve(root,'.local/verification/cli-open-'+randomUUID());await mkdir(directory,{recursive:true});
const previous=fixture(root,18254);
await writeFile(resolve(directory,'state.json'),JSON.stringify({projects:[previous.project],demos:[previous.demo],captures:[],selection:{generation:0}}));
const env={...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_HEADLESS:'1',QT_SCALE_FACTOR:'1.6',DERP_SCREENSHOT:resolve(directory,'canvas.png'),DERP_SCREENSHOT_DELAY_MS:'12000'};
const proc=Bun.spawn(['bun','scripts/cli.ts','open','--project','cli-real','--demo','cli-demo','--pane','cli-ladybird','--port','18253','--state-dir',directory],{cwd:root,env,stdout:Bun.file(resolve(directory,'open.json')),stderr:Bun.file(resolve(directory,'host.log'))});
const client=new Client({name:'cli-open-test',version:'1'}),token=(await readFile(resolve(root,'.local/workspace-token'),'utf8')).trim();
async function call(name:string,params:any={}){const r=await client.callTool({name,arguments:{params}});assert(!r.isError,JSON.stringify(r));return JSON.parse((r.content as any[]).find(x=>x.type==='text').text)}
try{
 for(let n=0;;n++){assert((proc.exitCode===null||proc.exitCode===0)&&n<100,'CLI launch failed');try{if((await fetch('http://127.0.0.1:18253/health',{headers:{Authorization:`Bearer ${token}`}})).ok)break}catch{}await Bun.sleep(100)}
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:18253/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 let info;for(let n=0;;n++){info=await call('workspace_info');if(info.focusRequest?.paneId==='cli-ladybird')break;assert(n<100);await Bun.sleep(100)}
 const generation=info.selection.generation,initialFocus=structuredClone(info.focusRequest);
 const second=Bun.spawn(['bun','scripts/cli.ts','open','--project','cli-real','--demo','cli-demo','--pane','cli-chromium','--url','http://127.0.0.1:18253/mcp'],{cwd:root,stdout:'pipe',stderr:'pipe'});assert.equal(await second.exited,0,await new Response(second.stderr).text());
 info=await call('workspace_info');assert.equal(info.selection.generation,generation);assert.deepEqual(info.focusRequest,initialFocus,'Reopening with --pane must not activate the existing window');assert.equal((await call('demo_list',{projectId:'cli-real'}))[0].panes.length,2);
 const present=Bun.spawn(['bun','scripts/cli.ts','open','--project','cli-real','--demo','cli-demo','--url','http://127.0.0.1:18253/mcp'],{cwd:root,stdout:'pipe',stderr:'pipe'});assert.equal(await present.exited,0);assert.deepEqual((await call('workspace_info')).focusRequest,initialFocus,'Reopening without --pane must not present the existing window');
 await client.close();assert.equal(await proc.exited,0,await readFile(resolve(directory,'host.log'),'utf8'));
 // The CLI returns immediately; the owned test window closes after its timed capture.
 for(let n=0;await Bun.file(resolve(directory,'runtime.lock')).exists()&&n<200;n++)await Bun.sleep(100);
 assert(await Bun.file(resolve(directory,'canvas.png')).exists());assert(!await Bun.file(resolve(directory,'runtime.lock')).exists());console.log('PASS CLI launch selection/focus, reuse without reset or window activation, all panes retained, exit cleanup:',directory);
}finally{await client.close().catch(()=>{});if(proc.exitCode===null){proc.kill('SIGTERM');await proc.exited}
 const lock=resolve(directory,'runtime.lock');if(await Bun.file(lock).exists()){const pid=Number(await readFile(lock,'utf8'));process.kill(pid,'SIGTERM');}}
