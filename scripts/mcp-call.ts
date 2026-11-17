import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
const [name, flag, value] = process.argv.slice(2);
if (!name || (flag && flag !== '--file')) throw Error('Usage: bun scripts/mcp-call.ts list | <tool> [--file params.json]');
const client = new Client({name:'derpdesign-cli',version:'1'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dir,'mcp.ts')],env:process.env as Record<string,string>}));
  const result = name === 'list' ? await client.listTools() : await client.callTool({name,arguments:{params:value ? await Bun.file(value).json() : {}}});
  // Preserve text/evidence paths but don't flood the agent console with base64 PNGs.
  if ('content' in result && Array.isArray(result.content)) console.log(JSON.stringify({...result,content:result.content.map((entry:any)=>entry.type==='image'?{type:'image',mimeType:entry.mimeType,note:'Image available at screenshotPath in the text evidence record'}:entry)},null,2));
  else console.log(JSON.stringify(result,null,2));
  if ('isError' in result && result.isError) process.exitCode=1;
} finally { await client.close(); }
