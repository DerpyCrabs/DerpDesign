import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export async function serveProxy(onClose?:()=>Promise<void>) {
const token = process.env.DERP_WORKSPACE_TOKEN;
if (!token) throw Error("DERP_WORKSPACE_TOKEN required");
const upstream = new Client({ name: "derpdesign-stdio", version: "1.0.0" });
await upstream.connect(
  new StreamableHTTPClientTransport(
    new URL(process.env.DERP_WORKSPACE_MCP_URL ?? "http://127.0.0.1:47831/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  ),
);
const server = new Server(
  { name: "derpdesign", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, (request) =>
  upstream.callTool(request.params),
);
await server.connect(new StdioServerTransport());

let closing=false;
const close=async()=>{if(closing)return;closing=true;await upstream.close();await server.close();await onClose?.();};
process.stdin.once('end',()=>{void close()});
process.once('SIGTERM',()=>{void close()});process.once('SIGINT',()=>{void close()});
server.onclose=()=>{void close()};
return {server,close};
}
if(import.meta.main)await serveProxy();
