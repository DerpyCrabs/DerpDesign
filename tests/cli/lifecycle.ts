import {fixture} from './fixture';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..'),directory=resolve(root,'.local/verification/cli-lifecycle-'+randomUUID());await mkdir(directory,{recursive:true});
const {project,demo}=fixture(root,18256);
await writeFile(resolve(directory,'state.json'),JSON.stringify({projects:[project],demos:[demo],captures:[],selection:{generation:0}}));
const transport=new StdioClientTransport({command:resolve(root,'bin/derpdesign'),args:['mcp','--headless','--state-dir',directory,'--port','18255','--project',project.id,'--demo',demo.id],stderr:'pipe'});
let log='';transport.stderr?.on('data',c=>{log+=c.toString()});
const client=new Client({name:'cli-lifecycle',version:'1'});
async function call(name:string,params:any={}){const r=await client.callTool({name,arguments:{params}});assert(!r.isError,JSON.stringify(r));return JSON.parse((r.content as any[]).find(x=>x.type==='text').text)}
let descendants:number[]=[];
try{
 await client.connect(transport);const info=await call('workspace_info');assert.equal(info.selection.demoId,demo.id);
 await call('pane_capture',{paneId:'cli-chromium'});await call('pane_capture',{paneId:'cli-ladybird'});
 const duplicate=Bun.spawn([resolve(root,'bin/derpdesign'),'mcp','--headless','--state-dir',directory],{stdout:'pipe',stderr:'pipe'});assert.equal(await duplicate.exited,1);assert.match(await new Response(duplicate.stderr).text(),/already owned/);
 const map=new Map<number,number>();for(const name of await readdir('/proc'))if(/^\d+$/.test(name))try{map.set(+name,+(await readFile(`/proc/${name}/stat`,'utf8')).split(') ')[1].split(' ')[1])}catch{}
 const tree=new Set([transport.pid!]);let growing=true;while(growing){growing=false;for(const [pid,ppid]of map)if(tree.has(ppid)&&!tree.has(pid)){tree.add(pid);growing=true}}descendants=[...tree];assert(descendants.length>5);
 process.kill(transport.pid!,'SIGTERM');
 for(let i=0;i<150&&await Bun.file(resolve(directory,'runtime.lock')).exists();i++)await Bun.sleep(100);
 assert(!await Bun.file(resolve(directory,'runtime.lock')).exists(),'Signal cleanup incomplete');
 await client.close();await transport.close();
 const survivors=[];for(const pid of descendants)try{await readFile(`/proc/${pid}/stat`);survivors.push(pid)}catch{}
 assert.deepEqual(survivors,[],'Owned processes survived shutdown');
 console.log('PASS initial selection, state locking, SIGTERM cleanup of',descendants.length,'processes:',directory);
}finally{await client.close().catch(()=>{});await transport.close();await writeFile(resolve(directory,'host.log'),log)}
