import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dir, '../..');
const evidence = resolve(root, '.local/verification');
await mkdir(evidence, {recursive:true});
const app = Bun.spawn(['bun','scripts/start.ts'], {cwd:root,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_WORKSPACE_PORT:'47841',DERP_STATE_DIR:resolve(evidence,'desktop-workspace'),DERP_SCREENSHOT:resolve(evidence,'desktop-live.png'),DERP_SCREENSHOT_DELAY_MS:'14000'}, stdout:'ignore',stderr:Bun.file(resolve(evidence,'desktop-live.log'))});
let client: Client | undefined;
try {
  for(let i=0;i<100;i++) {
    if(app.exitCode!==null) throw Error('Desktop exited: '+await readFile(resolve(evidence,'desktop-live.log'),'utf8'));
    try { if((await fetch('http://127.0.0.1:47841/health')).status===401) break; } catch {}
    await Bun.sleep(100);
  }
  client = new Client({name:'desktop-integration',version:'1'});
  await client.connect(new StdioClientTransport({command:'bun',args:[resolve(root,'scripts/mcp.ts')],env:{...process.env as Record<string,string>,DERP_WORKSPACE_MCP_URL:'http://127.0.0.1:47841/mcp'}}));
  async function call(name:string,params:any={}) {
    const reply = await client!.callTool({name,arguments:{params}});
    assert(!reply.isError,JSON.stringify(reply));
    return JSON.parse((reply.content as any[]).find(c=>c.type==='text').text);
  }
  await call('project_register',{id:'desktop-smoke',name:'Engine smoke',sourceRoot:root,supportRoot:resolve(root,'tests/chromium'),server:{command:['python3','-m','http.server','47842','--bind','127.0.0.1','--directory',resolve(root,'tests/chromium')],cwd:root,url:'http://127.0.0.1:47842'}}).catch(async e=>{
    if(!String(e).includes('already exists'))throw e;
  });
  await call('demo_put',{id:'desktop-smoke-demo',projectId:'desktop-smoke',name:'CEF live canvas',description:'Real native worker integration test',panes:[{id:'native-pane',name:'Interactive fixture',engine:'chromium',viewport:{width:800,height:600,deviceScaleFactor:1},position:{x:20,y:20},route:'/fixture.html',conditions:{}}]});
  for(let i=0;i<50;i++) {
    const status=await call('engine_status');
    if(Array.isArray(status))break;
    await Bun.sleep(100);
  }
  await call('selection_set',{projectId:'desktop-smoke',demoId:'desktop-smoke-demo'});
  await Bun.sleep(900);
  for(const action of ['down','up']) await call('pane_input',{paneId:'native-pane',event:{type:'pointer',action,x:40,y:28,button:'left'}});
  for(const action of ['down','up']) await call('pane_input',{paneId:'native-pane',event:{type:'pointer',action,x:40,y:80,button:'left'}});
  await call('pane_input',{paneId:'native-pane',event:{type:'text',text:'Through MCP and Qt'}});
  await Bun.sleep(300);
  const capture=await call('pane_capture',{paneId:'native-pane'});
  await writeFile(resolve(evidence,'desktop-live-capture.json'),JSON.stringify(capture,null,2));
  assert.equal(capture.engine,'chromium');
  assert.equal(capture.viewport.width,800);
  await client.close(); client=undefined;
  assert.equal(await app.exited,0);
  const log=await readFile(resolve(evidence,'desktop-live.log'),'utf8');
  assert(!/ReferenceError|TypeError|failed to load component/.test(log),log);
  console.log('PASS: actual CEF -> Qt frame surface; MCP selection/input/capture; desktop screenshot saved');
} finally {
  await client?.close();
  if(app.exitCode===null){app.kill();await app.exited;}
}
