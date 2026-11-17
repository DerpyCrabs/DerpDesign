import {fixture} from './fixture';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dir,'../..'),directory=resolve(root,'.local/verification/cli-'+randomUUID());await mkdir(directory,{recursive:true});
const port=18251,url=`http://127.0.0.1:${port}/mcp`;
const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'scripts/cli.ts'),'mcp','--headless','--state-dir',directory,'--port',String(port),'--scale','1.6'],stderr:'pipe'});
transport.stderr?.on('data',chunk=>{void Bun.write(Bun.stderr,chunk)});
const client=new Client({name:'cli-real-test',version:'1'});
async function call(name:string,params:any={}){const r=await client.callTool({name,arguments:{params}});assert(!r.isError,JSON.stringify(r));return JSON.parse((r.content as any[]).find(x=>x.type==='text').text)}
async function cli(args:string[],ok=true){const p=Bun.spawn(['bun','scripts/cli.ts',...args,'--url',url],{cwd:root,stdout:'pipe',stderr:'pipe'});const out=await new Response(p.stdout).text(),err=await new Response(p.stderr).text();assert.equal(await p.exited,ok?0:1,err);return out;}
const {project,demo}=fixture(root,18252);
try{
 await client.connect(transport);
 assert.equal((await call('workspace_info')).hostMode,'headless');
 await call('project_register',project);await call('demo_put',demo);await call('selection_set',{projectId:project.id,demoId:demo.id});
 for(const pane of demo.panes){
  const hit=await call('pane_inspect',{paneId:pane.id,selector:'#counter'}),b=hit.element.bounds;
  for(const action of ['down','up'])await call('pane_input',{paneId:pane.id,event:{type:'pointer',action,button:'left',x:b.x+b.width/2,y:b.y+b.height/2}});
  const result=JSON.parse(await cli(['inspect','--pane',pane.id,'--selector','#counter']));assert.equal(result.element.text,'1');
  const path=resolve(directory,pane.id+'.png');await cli(['screenshot','--pane',pane.id,'--out',path]);const png=await readFile(path);assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),480);
 }
 await cli(['snapshot','--demo',demo.id,'--out',resolve(directory,'bundle')]);const bundle=JSON.parse(await readFile(resolve(directory,'bundle/snapshot.json'),'utf8'));assert.equal(bundle.captures.length,2);assert(bundle.captures.every((c:any)=>c.engineVersion&&c.sourceFingerprint&&c.harnessFingerprint));
 await cli(['open','--project',project.id,'--demo',demo.id,'--pane','cli-ladybird'],false);
 await cli(['inspect','--pane','missing'],false);
 const before=(await call('workspace_info')).selection.generation;await call('pane_focus',{paneId:'cli-ladybird'});assert.equal((await call('workspace_info')).selection.generation,before);
 console.log('PASS real windowless MCP, CLI inspection/screenshots at1.6, snapshot metadata, invalid inputs:',directory);
}finally{await client.close();await transport.close();}
for(let i=0;i<100&&await Bun.file(resolve(directory,'runtime.lock')).exists();i++)await Bun.sleep(100);
assert(!await Bun.file(resolve(directory,'runtime.lock')).exists(),'MCP EOF did not clean up runtime');
await writeFile(resolve(directory,'verified.json'),JSON.stringify({project,demo,url},null,2));
console.log('PASS EOF ownership cleanup');
