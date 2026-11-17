# Workspace and engine protocol, version 1

Workspace listens only on loopback (default 127.0.0.1:47831). Qt and MCP share the same workspace instance. GUI calls POST /rpc with JSON `{id, method, params}` and receives `{id,result}` or `{id,error:{code,message}}`. GET /health reports readiness. GET /state returns projects, demos, selection and engine status. MCP uses official SDK Streamable HTTP at /mcp; a stdio bridge may connect to the same instance. UI events can initially poll state; runtime surfaces must not use state polling as their frame transport.

## Workspace operations

- project.list / project.register / project.update: external sourceRoot and supportRoot, command argument array (never shell string), cwd, server URL.
- demo.list / demo.put: stable ID and projectId, name, description, panes (no numeric pane-count limit).
- selection.set: projectId and demoId; any authorized MCP agent may switch. generation monotonically increments; serialized transitions dispose old pane runtimes before opening new ones.
- pane.inspect: paneId, optional selector or point, requested computed properties. Read-only DOM, CSS, geometry, source, logs. No arbitrary JavaScript evaluation tool.
- pane.input: paneId and typed input event; pane.reset and pane.resize.
- pane.capture: waits for current generation readiness; saves screenshot, inspection and evidence metadata. A generation/fingerprint change during capture rejects stale evidence.
- engine.status: explicit capability reports; missing engine is unavailable, never silently substituted.

Project/demos persisted atomically; captures indexed alongside workspace state. Binary captures kept in .local/artifacts. Local project paths ignored by Git. Validate IDs, finite positive dimensions, commands, relative pane routes, and references. A failed startup must be visible and must clean up child processes. Keep stdout free of logs for stdio MCP.

## Engine boundary

Workspace engine controller can send request/reply messages via a local WebSocket to the Qt host. Qt owns displayed surfaces and routes operations to the actual engine adapters. Engine work must have request IDs, deadlines, generation and pane IDs. Disconnect rejects pending work; never manufacture successful screenshot/inspection results.

Methods: engine.status, session.open (generation, projectId, demoId, panes with resolved URL and fixture conditions), session.close, pane.input, pane.resize, pane.reset, pane.inspect, pane.capture, pane.ready. UI control and engine APIs are separate: session.open is not exposed directly to agents. Host reports actual engine versions/capabilities. Future standalone workers may implement the same boundary without changing MCP.

Frame transport is native image/texture sharing between adapters and Qt canvas, not base64 through MCP. Captures return paths to generated PNGs; MCP returns image content or artifact resources supported by SDK.

Harness scripts set window.__DERPDESIGN__ = { ready: boolean, error?: string, reset?: () => Promise<void> }. Ready means scenario settled enough for review, not that all network requests stopped. The controller's readiness check is a fixed internal operation, not agent-provided JavaScript. Expose detailed harness errors. Browser storage is isolated per pane run.
