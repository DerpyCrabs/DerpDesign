import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, start } from "./main";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
test("persistence, unlimited panes, disconnect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-"));
  try {
    const w = await new Workspace(dir).init();
    await w.call("project.register", {
      id: "p",
      name: "P",
      sourceRoot: dir,
      supportRoot: dir,
      server: { command: ["bun", "x"], cwd: dir, url: "http://localhost:3000" },
    });
    const panes = Array.from({ length: 50 }, (_, i) => ({
      id: "pane" + i,
      name: "pane",
      engine: "chromium",
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      position: { x: 0, y: 0 },
      route: "/",
      conditions: {},
    }));
    await w.call("demo.put", {
      id: "d",
      projectId: "p",
      name: "D",
      description: "",
      panes,
    });
    expect((await new Workspace(dir).init()).state.demos[0].panes).toHaveLength(
      50,
    );
    await expect(
      w.call("selection.set", { projectId: "p", demoId: "d" }),
    ).rejects.toThrow("unavailable");
    w.attach({ send() {} });
    const pending = w.engine("pane.capture");
    w.disconnect();
    await expect(pending).rejects.toThrow("disconnected");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("official MCP initialize and tool discovery, registration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-mcp-"));
  const { server, workspace } = await start({
    directory: dir,
    port: 0,
    token: "test-agent",
    desktopToken: "test-desktop",
  });
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.port}/mcp`),
        { requestInit: { headers: { Authorization: "Bearer test-agent" } } },
      ),
    );
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name.startsWith("annotation_"))).toBe(false);
    expect(tools.tools.some((t) => t.name === "project_register")).toBe(true);
    const result = await client.callTool({
      name: "project_register",
      arguments: {
        params: {
          id: "p",
          name: "P",
          sourceRoot: dir,
          supportRoot: dir,
          server: { command: ["bun"], cwd: dir, url: "http://localhost:3000" },
        },
      },
    });
    expect(result.isError).toBeUndefined();
    expect(workspace.state.projects).toHaveLength(1);
  } finally {
    await client.close();
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart clears runtime selection; deactivation works disconnected; late replies ignored", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-restart-"));
  const first = await new Workspace(directory).init();
  first.state.selection = { projectId: "p", demoId: "d", generation: 7 };
  first.state.annotations = [{ id: "legacy-note", text: "Old feedback" }];
  await first.save();
  const restored = await new Workspace(directory).init();
  expect(restored.state.selection).toEqual({
    projectId: null,
    demoId: null,
    generation: 8,
  });
  expect(restored.state).not.toHaveProperty("annotations");
  restored.attach({ send() {} });
  const pending = restored.engine("pane.ready");
  restored.disconnect();
  await expect(pending).rejects.toThrow("disconnected");
  restored.reply(JSON.stringify({ id: "old", result: { success: true } }));
  restored.attach({ send() {} });
  expect(restored.pending.size).toBe(0);
  restored.disconnect();
  expect(
    (await restored.call("selection.set", { projectId: null, demoId: null }))
      .generation,
  ).toBe(9);
  await expect(
    restored.call("pane.inspect", { paneId: "p", eval: "1" }),
  ).rejects.toThrow();
  await rm(directory, { recursive: true, force: true });
});

import { writeFile, readFile } from "node:fs/promises";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fingerprint } from "./fingerprint";

test("real stdio proxy forwards discovery, calls, PNG; stale source is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-proxy-"));
  const root = join(dir, "source");
  await Bun.$`mkdir -p ${root}`.quiet();
  await Bun.$`git -C ${root} init`.quiet();
  await writeFile(join(root, ".gitignore"), "vendor/\nbuild/\n");
  await writeFile(join(root, "source.txt"), "before");
  const initial = await fingerprint(root);
  await Bun.$`mkdir -p ${root}/vendor/build`.quiet();
  await writeFile(join(root, "vendor/build/output"), "ignored");
  expect(await fingerprint(root)).toBe(initial);
  const { server, workspace: w } = await start({ directory: join(dir, "state"), port: 0, token: "ai", desktopToken: "ui" });
  const client = new Client({ name: "proxy-test", version: "1" });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  let mutate = false;
  try {
    w.state.projects = [{ id: "p", sourceRoot: root, supportRoot: root }];
    w.state.demos = [{ id: "d", projectId: "p", panes: [{ id: "pane", engine: "chromium", viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, conditions: {} }] }];
    w.state.selection = { projectId: "p", demoId: "d", generation: 2 };
    // Controlled protocol double: this establishes no real rendering coverage.
    w.attach({ send(raw: string) {
      const request = JSON.parse(raw);
      void (async () => {
        if (mutate && request.method === "pane.capture") await writeFile(join(root, "source.txt"), "changed");
        w.reply(JSON.stringify({ id: request.id, result: request.method === "pane.capture" ? { generation: 2, engineVersion: "controlled-double", pngBase64: png, inspection: {} } : {} }));
      })();
    } });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, "stdio.ts")], env: { ...process.env as Record<string,string>, DERP_WORKSPACE_TOKEN: "ai", DERP_WORKSPACE_MCP_URL: `http://127.0.0.1:${server.port}/mcp` } }));
    const tools = (await client.listTools()).tools;
    expect(tools.find(t => t.name === "pane_capture")!.inputSchema.properties!.params).toHaveProperty("properties");
    const result = await client.callTool({ name: "pane_capture", arguments: { params: { paneId: "pane" } } });
    expect(result.isError).toBeUndefined();
    expect((result.content as any[]).find(c => c.type === "image")).toEqual({ type: "image", mimeType: "image/png", data: png });
    mutate = true;
    const stale = await client.callTool({ name: "pane_capture", arguments: { params: { paneId: "pane" } } });
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale)).toContain("Stale capture");
    expect(w.state.captures).toHaveLength(1);
    const rpc = async (token: string, method: string, params: any) => (await fetch(`http://127.0.0.1:${server.port}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ method, params }) })).json() as Promise<any>;
    for (const token of ["ai", "ui"]) {
      for (const method of ["annotation.list", "annotation.create", "annotation.respond", "annotation.update", "annotation.resolve", "annotation.delete"])
        expect((await rpc(token, method, {})).error.message).toContain("Unknown method");
    }
  } finally {
    await client.close();
    w.disconnect();
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});

test("owned process group cleanup kills a real descendant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-group-"));
  const w = await new Workspace(dir).init();
  try {
    w.process = Bun.spawn(["sh", "-c", 'sleep 120 & echo $! > "$1"; wait', "sh", join(dir, "pid")], { detached: true });
    for (let i = 0; i < 100; i++) {
      if (await Bun.file(join(dir, "pid")).exists()) break;
      await Bun.sleep(10);
    }
    const pid = Number(await readFile(join(dir, "pid"), "utf8"));
    expect(pid).toBeGreaterThan(0);
    await w.stop();
    let running = true;
    for (let i = 0; i < 100; i++) {
      try { running = !(await readFile(`/proc/${pid}/stat`, "utf8")).includes(") Z "); } catch { running = false; }
      if (!running) break;
      await Bun.sleep(10);
    }
    expect(running).toBe(false);
  } finally { await w.stop(); await rm(dir, { recursive: true, force: true }); }
});

test("generation-bound input is discarded after selection changes, including reused pane IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-input-"));
  try {
    const w = await new Workspace(dir).init();
    const oldGeneration = w.state.selection.generation;
    w.state.selection = { projectId: null, demoId: null, generation: oldGeneration + 1 };
    const event = { type: "pointer", action: "leave", x: -1, y: -1 };
    expect(await w.call("pane.input", {paneId:"p", expectedGeneration:oldGeneration, event})).toEqual({ignored:true,reason:"stale-generation"});
    await expect(w.call("pane.input", {paneId:"p", event})).rejects.toThrow("No active pane");
    w.state.selection = { projectId:"project", demoId:"demo", generation:oldGeneration+2 };
    w.state.demos = [{id:"demo",projectId:"project",panes:[{id:"p"}]}];
    let dispatched = false;
    w.engine = async () => { dispatched = true; return true; };
    expect(await w.call("pane.input", {paneId:"p",expectedGeneration:oldGeneration,event})).toEqual({ignored:true,reason:"stale-generation"});
    expect(dispatched).toBe(false);
    await w.call("pane.input", {paneId:"p",expectedGeneration:oldGeneration+2,event});
    expect(dispatched).toBe(true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("an explicit switch cancels desktop restore before it opens the previous demo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-restore-"));
  try {
    const old = await new Workspace(directory).init();
    old.state.selection = {projectId:"p", demoId:"d", generation:3};
    old.state.demos = [{id:"d", projectId:"p"}];
    await old.save();
    const workspace = await new Workspace(directory, true).init();
    workspace.hostMode = "window";
    const methods:string[] = [];
    workspace.attach({send(raw:string) {
      const {method,id} = JSON.parse(raw);
      methods.push(method);
      workspace.reply(JSON.stringify({id,result:{}}));
    }});
    await workspace.call("selection.set", {projectId:null, demoId:null});
    expect(methods).toEqual(["session.close"]);
    expect(workspace.state.lastDesktopSelection.demoId).toBeNull();
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
});
