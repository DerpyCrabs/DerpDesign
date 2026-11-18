import { fingerprint } from "./fingerprint";
import { z } from "zod";
import { mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import { resolve, isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/),
  positive = z.number().positive().finite();
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const project = z.object({
  id,
  name: z.string().min(1),
  sourceRoot: z.string().refine(isAbsolute),
  supportRoot: z.string().refine(isAbsolute),
  server: z.object({
    command: z.array(z.string()).min(1),
    cwd: z.string().refine(isAbsolute),
    url: z.string().url(),
    readyTimeoutMs: positive.optional(),
  }),
});
const pane = z.object({
  id,
  name: z.string(),
  engine: z.enum(["chromium", "ladybird"]),
  viewport: z.object({
    width: positive,
    height: positive,
    deviceScaleFactor: z.union([positive, z.literal("display")]),
  }),
  position: point,
  route: z
    .string()
    .refine(
      (s) => s.startsWith("/") && !s.startsWith("//") && !s.includes("\\"),
    ),
  conditions: z.record(z.unknown()),
});
const demo = z.object({
  id,
  projectId: id,
  name: z.string(),
  description: z.string(),
  panes: z
    .array(pane)
    .refine((p) => new Set(p.map((x) => x.id)).size === p.length),
});
export class Workspace {
  state: any = {
    projects: [],
    demos: [],
    captures: [],
    selection: { projectId: null, demoId: null, generation: 0 },
  };
  socket: any;
  pending = new Map<string, any>();
  tail: Promise<any> = Promise.resolve();
  process: ReturnType<typeof Bun.spawn> | undefined;
  hostMode = "unknown";
  private restoreAbort?: AbortController;
  private resumeSelection?: {projectId:string; demoId:string; generation:number};
  constructor(public directory: string, private restoreDesktop = false) {}
  async init() {
    await mkdir(join(this.directory, "artifacts"), { recursive: true });
    try {
      this.state = JSON.parse(
        await readFile(join(this.directory, "state.json"), "utf8"),
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    delete this.state.annotations; // Ignore legacy feedback when loading older workspaces.
    delete this.state.focusRequest;
    const previous = this.state.lastDesktopSelection ?? this.state.selection;
    if (this.restoreDesktop && this.state.demos.some((d:any) =>
        d.id === previous.demoId && d.projectId === previous.projectId))
      this.resumeSelection = previous;
    if (this.restoreDesktop) this.state.lastDesktopSelection = previous;
    this.state.selection = {
      projectId: null,
      demoId: null,
      generation: this.state.selection.generation + 1,
    };
    return this;
  }
  async save() {
    const file = join(this.directory, "state.json");
    await writeFile(file + ".tmp", JSON.stringify(this.state));
    await rename(file + ".tmp", file);
  }
  attach(socket: any) {
    if (this.socket) throw Error("Engine already connected");
    this.socket = socket;
    const previous = this.resumeSelection;
    if (previous) {
      this.resumeSelection = undefined;
      const controller = new AbortController();
      this.restoreAbort = controller;
      // Enqueue before accepting any subsequent selection or focus request.
      void this.call("selection.set", {projectId:previous.projectId, demoId:previous.demoId},
        true, {generation:previous.generation, signal:controller.signal})
        .catch(error => { if (!controller.signal.aborted) console.error("Desktop restore failed:", error); })
        .finally(() => { this.restoreAbort = undefined; });
    }
  }
  disconnect() {
    this.socket = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Engine disconnected"));
    }
    this.pending.clear();
  }
  reply(raw: string) {
    const r = JSON.parse(raw),
      p = this.pending.get(r.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(r.id);
    r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result);
  }
  engine(method: string, params: any = {}) {
    if (!this.socket)
      return Promise.reject(
        Error("Engine unavailable: Qt host is not connected"),
      );
    const timeoutMs = Number(process.env.DERP_ENGINE_TIMEOUT_MS ?? 30000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)
      return Promise.reject(Error("DERP_ENGINE_TIMEOUT_MS must be a positive timer duration in milliseconds"));
    const requestId = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error("Engine deadline exceeded"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          id: requestId,
          method,
          params,
          deadline: Date.now() + timeoutMs,
        }),
      );
    });
  }
  call(method: string, params: any = {}, ui = false, restore?: { generation:number; signal:AbortSignal }) {
    if (method === "selection.set" && !restore) {
      this.resumeSelection = undefined;
      this.restoreAbort?.abort();
    }
    const run = this.tail.then(() => this.execute(method, params, ui, restore));
    this.tail = run.catch(() => {});
    return run;
  }
  async stop() {
    if (this.process) {
      try {
        process.kill(-this.process.pid, "SIGKILL");
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
    }
    if (this.process) await this.process.exited;
    this.process = undefined;
  }
  async execute(method: string, p: any, ui: boolean, restore?: { generation:number; signal:AbortSignal }): Promise<any> {
    if (method === "workspace.info") return {selection:this.state.selection,focusRequest:this.state.focusRequest??null,hostMode:this.hostMode,directory:this.directory,engineConnected:!!this.socket};
    if (method === "window.present") {
      if(this.hostMode === "headless") throw Error("This host has no window");
      this.state.focusRequest={paneId:null,generation:this.state.selection.generation,nonce:crypto.randomUUID()};
      await this.save();return this.state.focusRequest;
    }
    if (method === "pane.focus") {
      const d=this.state.demos.find((d:any)=>d.id===this.state.selection.demoId);
      if(!d?.panes.some((pn:any)=>pn.id===p.paneId))throw Error("Pane is not in the active demo");
      this.state.focusRequest={paneId:p.paneId,generation:this.state.selection.generation,nonce:crypto.randomUUID()};
      await this.save();return this.state.focusRequest;
    }
    if (method === "project.list") return this.state.projects;
    if (method === "demo.list")
      return this.state.demos.filter(
        (d: any) => !p.projectId || d.projectId === p.projectId,
      );
    if (method === "performance.snapshot") {
      if (!this.socket) throw Error("Qt host disconnected");
      return this.engine(method);
    }
    if (method === "engine.status")
      return this.socket
        ? this.engine(method)
        : { available: false, reason: "Qt host disconnected" };
    if (method === "project.register" || method === "project.update") {
      const value = project.parse(p),
        i = this.state.projects.findIndex((x: any) => x.id === value.id);
      if (method === "project.register" && i >= 0)
        throw Error("Project already exists");
      if (method === "project.update" && i < 0) throw Error("Unknown project");
      if (this.state.selection.projectId === value.id) {
        await this.engine("session.close", this.state.selection);
        await this.stop();
        this.state.selection = {
          projectId: null,
          demoId: null,
          generation: this.state.selection.generation + 1,
        };
        if (this.hostMode === "window") this.state.lastDesktopSelection = this.state.selection;
      }
      if (i < 0) this.state.projects.push(value);
      else this.state.projects[i] = value;
      await this.save();
      return value;
    }
    if (method === "demo.put") {
      const value = demo.parse(p);
      if (!this.state.projects.some((x: any) => x.id === value.projectId))
        throw Error("Unknown project");
      const active = this.state.selection.demoId === value.id;
      const i = this.state.demos.findIndex((x: any) => x.id === value.id);
      const previous = this.state.demos[i];
      const changedPanes = active && (previous.projectId !== value.projectId || JSON.stringify(previous.panes) !== JSON.stringify(value.panes));
      if (changedPanes && !this.socket) throw Error("Engine unavailable");
      if (i < 0) this.state.demos.push(value);
      else this.state.demos[i] = value;
      if (changedPanes) {
        try {
          await this.execute("selection.set", {projectId:value.projectId,demoId:value.id}, ui);
        } catch (error) {
          this.state.demos[i] = previous;
          await this.save();
          // A failed replacement must not leave a new declaration claiming old panes.
          await this.execute("selection.set", {projectId:previous.projectId,demoId:previous.id}, ui).catch(() => {});
          throw error;
        }
      }
      await this.save();
      return value;
    }
    if (method === "demo.delete") {
      if (!this.state.demos.some((x:any) => x.id === p.id)) throw Error("Unknown demo");
      if (this.state.selection.demoId === p.id) await this.execute("selection.set", {projectId:null,demoId:null}, ui);
      this.state.demos = this.state.demos.filter((x:any) => x.id !== p.id);
      await this.save();
      return {id:p.id,deleted:true};
    }
    if (method === "selection.set") {
      restore?.signal.throwIfAborted();
      if (p.projectId === null && p.demoId === null) {
        if (this.socket)
          await this.engine("session.close", this.state.selection);
        await this.stop();
        this.state.selection = {
          projectId: null,
          demoId: null,
          generation: this.state.selection.generation + 1,
        };
        if (this.hostMode === "window") this.state.lastDesktopSelection = this.state.selection;
        await this.save();
        return this.state.selection;
      }
      const d = this.state.demos.find(
          (x: any) => x.id === p.demoId && x.projectId === p.projectId,
        ),
        pr = this.state.projects.find((x: any) => x.id === p.projectId);
      if (!d || !pr) throw Error("Unknown project/demo");
      if (!this.socket) throw Error("Engine unavailable");
      await this.engine("session.close", this.state.selection);
      await this.stop();
      const generation = this.state.selection.generation + 1;
      this.state.selection = { projectId: null, demoId: null, generation };
      await this.save();
      try {
        this.process = Bun.spawn(pr.server.command, {
          cwd: pr.server.cwd,
          stdout: "ignore",
          stderr: "inherit",
          detached: true,
        });
        const until = Date.now() + (pr.server.readyTimeoutMs ?? 30000);
        while (true) {
          restore?.signal.throwIfAborted();
          if (this.process.exitCode !== null)
            throw Error("Project process exited");
          try {
            if ((await fetch(pr.server.url, {signal:restore?.signal})).ok) break;
          } catch {}
          if (Date.now() > until)
            throw Error("Project readiness deadline exceeded");
          await Bun.sleep(100);
        }
        await this.engine("session.open", {
          generation,
          projectId: pr.id,
          demoId: d.id,
          panes: d.panes.map((x: any) => ({
            ...x,
            url: this.paneUrl(x, pr.server.url),
          })),
        });
        restore?.signal.throwIfAborted();
        this.state.selection = { projectId: pr.id, demoId: d.id, generation,
          ...(restore ? {resumedFrom:restore.generation} : {}) };
        if (this.hostMode === "window") this.state.lastDesktopSelection = this.state.selection;
        await this.save();
        return this.state.selection;
      } catch (e) {
        await this.engine("session.close", { generation }).catch(() => {});
        await this.stop();
        throw e;
      }
    }
    if (method.startsWith("pane.")) {
      const s = this.state.selection,
        d = this.state.demos.find((x: any) => x.id === s.demoId),
        pn = d?.panes.find((x: any) => x.id === p.paneId),
        pr = this.state.projects.find((x: any) => x.id === s.projectId);
      // Native pointer events can arrive after the demo that produced them closed.
      // Generation-bound input is cancellation, not a failure of the new demo.
      if (method === "pane.input" && p.expectedGeneration !== undefined &&
          p.expectedGeneration !== s.generation) return { ignored: true, reason: "stale-generation" };
      if (!pn) throw Error("No active pane");
      if (method === "pane.move") {
        pn.position = point.parse(p.position);
        await this.save();
        return pn.position;
      }
      const args = { ...p, generation: s.generation };
      if (method === "pane.capture") {
        const before = await this.fingerprints(pr);
        await this.engine("pane.ready", args);
        const result = await this.engine(method, args);
        if (
          JSON.stringify(before) !== JSON.stringify(await this.fingerprints(pr))
        )
          throw Error("Stale capture: source changed");
        if (
          !result.pngBase64 ||
          !result.engineVersion ||
          result.generation !== s.generation
        )
          throw Error("Invalid capture reply");
        const cid = randomUUID(),
          screenshotPath = join(this.directory, "artifacts", cid + ".png"),
          inspectionPath = join(this.directory, "artifacts", cid + ".json");
        const bytes = Buffer.from(result.pngBase64, "base64");
        if (
          !bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw Error("Invalid PNG");
        await writeFile(screenshotPath, bytes);
        await writeFile(
          inspectionPath,
          JSON.stringify(result.inspection ?? null),
        );
        const c = {
          id: cid,
          ...s,
          paneId: pn.id,
          engine: pn.engine,
          engineVersion: result.engineVersion,
          ...before,
          viewport: pn.viewport,
          conditions: pn.conditions,
          screenshotPath,
          inspectionPath,
          createdAt: new Date().toISOString(),
        };
        this.state.captures.push(c);
        d.thumbnailCaptureId = cid;
        await this.save();
        return c;
      }
      if (
        !["pane.inspect", "pane.input", "pane.resize", "pane.reset"].includes(
          method,
        )
      )
        throw Error("Unknown method");
      if (method === "pane.inspect" && p.framePath?.length && pn.engine !== "ladybird")
        throw Error("Frame-targeted inspection is currently supported only by Ladybird");
      if (method === "pane.resize")
        args.viewport = z
          .object({
            width: positive,
            height: positive,
            deviceScaleFactor: z.union([positive, z.literal("display")]),
          })
          .parse(p.viewport);
      if (
        method === "pane.inspect" &&
        Object.keys(p).some(
          (k) => !["paneId", "selector", "point", "properties", "framePath", "geometryOnly"].includes(k),
        )
      )
        throw Error("Unsupported inspection parameter");
      if (method === "pane.input")
        z.object({
          event: z.discriminatedUnion("type", [
            z.object({ type: z.literal("text"), text: z.string() }),
            z.object({
              type: z.literal("key"),
              action: z.enum(["down", "up"]),
              key: z.string(),
              modifiers: z.array(z.string()).optional(),
            }),
            point.extend({
              type: z.literal("pointer"),
              action: z.enum(["move", "down", "up", "leave"]),
              button: z.enum(["left", "middle", "right"]).optional(),
            }),
            point.extend({
              type: z.literal("wheel"),
              deltaX: z.number().finite(),
              deltaY: z.number().finite(),
            }),
          ]),
        }).parse(p);
      if (method === "pane.inspect" && p.geometryOnly !== undefined) z.boolean().parse(p.geometryOnly);
      const r = await this.engine(method, args);
      if (method === "pane.resize") {
        pn.viewport = args.viewport;
        await this.save();
      }
      return r;
    }
    throw Error("Unknown method");
  }
  paneUrl(pane: any, base: string) {
    const url = new URL(pane.route, base);
    url.searchParams.set("__derp_conditions", JSON.stringify(pane.conditions ?? {}));
    return url.href;
  }
  async fingerprints(pr: any) {
    return {
      sourceFingerprint: await fingerprint(pr.sourceRoot),
      harnessFingerprint: await fingerprint(pr.supportRoot),
    };
  }
}
export const methods = [
  "workspace.info", "pane.focus", "window.present",
  "project.list",
  "project.register",
  "project.update",
  "demo.list",
  "demo.put", "demo.delete",
  "selection.set",
  "pane.inspect",
  "pane.input",
  "pane.reset",
  "pane.resize",
  "pane.move",
  "pane.capture",
  "engine.status",
  "performance.snapshot",
];
const paneRef = z.object({ paneId: id.describe("Pane in the active demo") });
const toolSchemas: Record<string, z.AnyZodObject> = {
  "project.list": z.object({}),
  "project.register": project,
  "project.update": project,
  "demo.list": z.object({ projectId: id.optional() }),
  "demo.put": demo,
  "demo.delete": z.object({id}),
  "selection.set": z.object({ projectId: id.nullable(), demoId: id.nullable() }),
  "workspace.info": z.object({}),
  "window.present": z.object({}),
  "pane.focus": paneRef,
  "pane.inspect": paneRef.extend({ geometryOnly: z.boolean().optional(), selector: z.string().optional(), point: point.optional(), properties: z.array(z.string()).optional(), framePath: z.array(z.string().min(1)).optional() }),
  "pane.input": paneRef.extend({ expectedGeneration: z.number().int().nonnegative().optional(), event: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("key"), action: z.enum(["down", "up"]), key: z.string(), modifiers: z.array(z.string()).optional() }),
    point.extend({ type: z.literal("pointer"), action: z.enum(["move", "down", "up", "leave"]), button: z.enum(["left", "middle", "right"]).optional() }),
    point.extend({ type: z.literal("wheel"), deltaX: z.number().finite(), deltaY: z.number().finite() }),
  ]) }),
  "pane.reset": paneRef,
  "pane.resize": paneRef.extend({ viewport: pane.shape.viewport }),
  "pane.move": paneRef.extend({ position: point }),
  "pane.capture": paneRef,
  "engine.status": z.object({}),
  "performance.snapshot": z.object({}).strict(),
};
const descriptions: Record<string, string> = {
  "project.list": "List registered projects.", "project.register": "Register project source roots and server command.",
  "project.update": "Update a project, closing its active session.", "demo.list": "List demos, optionally filtered by project.",
  "window.present": "Present the desktop window without changing canvas position.",
  "workspace.info": "Report active selection, focus request, host mode and connection state.",
  "pane.focus": "Focus a pane on the visible canvas without hiding other panes; records focus intent when headless.",
  "demo.put": "Create or replace a demo. Active pane changes reload the same demo without presenting the window; metadata-only edits preserve its session.", "demo.delete": "Delete a demo, closing its session if active.", "selection.set": "Activate a project/demo; pass both IDs as null to deactivate.",
  "pane.inspect": "Inspect an active pane by selector or point without executing code.", "pane.input": "Send a typed input event to an active pane.",
  "pane.move": "Move a pane on the canvas without changing its viewport or runtime.",
  "pane.reset": "Restart the pane scenario.", "pane.resize": "Resize the pane viewport.", "pane.capture": "Capture PNG and inspection evidence after readiness; reject changed sources.",
  "performance.snapshot": "Read bounded per-pane current-generation host counters and summed durations in milliseconds. Next-frame latency is observational, not causal or display presentation. No reset.",
  "engine.status": "Report connected engine capabilities or unavailability.",
};
export async function start(options: {
  restoreDesktop?: boolean;
  directory?: string;
  port?: number;
  token: string;
  desktopToken: string;
}) {
  const workspace = await new Workspace(
    resolve(options.directory ?? ".local/workspace"), options.restoreDesktop,
  ).init();
  const server = Bun.serve({
    // Engine operations enforce their own deadlines; MCP may stream longer than Bun's default HTTP idle timeout.
    idleTimeout: 0,
    hostname: "127.0.0.1",
    port: options.port ?? 47831,
    async fetch(req, server) {
      const u = new URL(req.url);
      if (!["127.0.0.1", "localhost"].includes(u.hostname))
        return new Response("Invalid host", { status: 403 });
      const origin = req.headers.get("origin");
      if (origin && origin !== u.origin)
        return new Response("Invalid origin", { status: 403 });
      const auth = req.headers.get("authorization");
      const ui = auth === `Bearer ${options.desktopToken}`;
      if (!ui && auth !== `Bearer ${options.token}`)
        return new Response("Unauthorized", { status: 401 });
      if (u.pathname === "/engine") {
        if (!ui) return new Response("Forbidden", { status: 403 });
        if (workspace.socket)
          return new Response("Already connected", { status: 409 });
        if (server.upgrade(req)) return;
        return new Response("Upgrade required", { status: 400 });
      }
      if (u.pathname === "/health") return Response.json({ ready: true });
      if (u.pathname === "/state")
        return Response.json({
          ...workspace.state,
          engine: { connected: !!workspace.socket },
        });
      if (u.pathname === "/rpc" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
          return Response.json({
            id: body.id,
            result: await workspace.call(body.method, body.params, ui),
          });
        } catch (e) {
          return Response.json({
            id: body?.id,
            error: { code: "WORKSPACE_ERROR", message: String(e) },
          });
        }
      }
      if (u.pathname === "/mcp") {
        const mcp = new McpServer({ name: "derpdesign", version: "1.0.0" });
        for (const method of methods)
          mcp.registerTool(
            method.replaceAll(".", "_"),
            { description: descriptions[method], inputSchema: { params: toolSchemas[method]!.describe(descriptions[method]!).optional() } },
            async ({ params }) => {
              try {
                const result = await workspace.call(method, params);
                return {
                  content: [
                    { type: "text" as const, text: JSON.stringify(result) },
                    ...(method === "pane.capture"
                      ? [
                          {
                            type: "image" as const,
                            mimeType: "image/png",
                            data: (
                              await readFile(result.screenshotPath)
                            ).toString("base64"),
                          },
                        ]
                      : []),
                  ],
                };
              } catch (e) {
                return {
                  isError: true,
                  content: [{ type: "text", text: String(e) }],
                };
              }
            },
          );
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        await mcp.connect(transport);
        return transport.handleRequest(req);
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        workspace.attach(ws);
      },
      message(ws, message) {
        try {
          workspace.reply(String(message));
        } catch {
          ws.close(1008, "Invalid reply");
        }
      },
      close() {
        workspace.disconnect();
      },
    },
  });
  return { server, workspace };
}
if (import.meta.main) {
  const token = process.env.DERP_WORKSPACE_TOKEN,
    desktopToken = process.env.DERP_DESKTOP_TOKEN;
  if (!token || !desktopToken || token === desktopToken)
    throw Error("Set distinct DERP_WORKSPACE_TOKEN and DERP_DESKTOP_TOKEN");
  await start({ token, desktopToken });
}
