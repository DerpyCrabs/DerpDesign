# Workspace backend

Run `DERP_WORKSPACE_TOKEN=... DERP_DESKTOP_TOKEN=... bun packages/workspace/src/main.ts` with distinct secrets. Binds 127.0.0.1:47831. State is atomic JSON in `.local/workspace/state.json`; PNG and inspection files live under artifacts. Back up this directory as a unit. One backend process per directory is required.

All endpoints require `Authorization: Bearer <token>`. Desktop token additionally permits engine WebSocket upgrades. Host and Origin checks reject nonlocal hosts and cross-origin browser requests. No CORS is enabled. Do not distribute the desktop token to agents.

GET /health, GET /state, POST /rpc ({id,method,params}), and official SDK stateless Streamable HTTP /mcp are implemented. MCP tool names replace dots with underscores and take `{params: {...}}`.

## Qt contract

Connect authenticated WebSocket `ws://127.0.0.1:47831/engine` with the desktop bearer header. Only one host may connect. Workspace sends JSON `{id,method,params,deadline}`; deadline is Unix milliseconds. Reply `{id,result}` or `{id,error:{code,message}}`. Replies must be JSON; unknown/late IDs are ignored. Disconnect rejects all pending requests; each request times out after 30 seconds. Host must stop work after its deadline, isolate pane storage per generation, and reject mismatched generations. Qt owns surfaces; this socket is control and discrete capture transport only.

session.close must be idempotent, including when generation has no open session. session.open receives generation, projectId, demoId and panes including resolved URL. Return success only when actual adapters have created their sessions. Each pane operation includes generation and paneId. pane.ready must await compilation, harness readiness and completed paint and report harness errors. pane.inspect accepts selector/point/properties; no eval is supported. pane.input receives typed `event`; pane.resize receives viewport. pane.reset restarts declared scenario. engine.status must report actual capabilities/version and unavailable-engine reasons; never substitute engines.

pane.capture result must contain `{generation,engineVersion,pngBase64,inspection}`. PNG bytes are validated by signature and saved locally; inspection is JSON. Base64 is used only for discrete screenshots, never runtime frames. Host must capture the requested generation and viewport after readiness. Workspace hashes Git tracked and nonignored untracked files beneath each source/support root before/after capture, including tracked deletions, and rejects changed fingerprints. Both roots must be in Git working directories. Ignored build/vendor output is excluded; repositories must configure their ignores appropriately. Tracked build output is still hashed. Metadata includes engine version, scenario conditions, viewport and generation. Qt must reject unsupported inspection or capture explicitly.

## Current limitations

No Qt adapter or real rendering engine is included. The stdio proxy uses the official SDK client and server and forwards tool discovery/results to the shared HTTP instance. Project servers launch in owned detached process groups; shutdown sends SIGKILL to the group. Descendants that deliberately leave the group are outside this ownership boundary. Fingerprinting does not follow symlinks. State is single-process JSON, not a concurrent database. Capture files and state are separate atomic writes; crashes can leave orphan artifacts. Readiness requests have a fixed 30-second engine deadline. Backend tests use no real engine and do not establish real rendering readiness.


## Integration additions

Deactivate with unchanged Qt RPC envelope: `selection.set {projectId:null,demoId:null}`.
This closes the engine session when connected, stops the project group, clears selection,
and increments generation. Then `demo.put` can update the previously active demo.
Startup clears persisted selection and increments generation because runtime sessions do
not survive backend restart.

Launch external T3 stdio integration with
`DERP_WORKSPACE_TOKEN=... bun packages/workspace/src/stdio.ts`.
Optional `DERP_WORKSPACE_MCP_URL` defaults to
`http://127.0.0.1:47831/mcp`. The HTTP service must already be running.
Successful MCP capture returns metadata text plus PNG image content; Qt RPC still
returns the existing artifact metadata and paths. MCP argument envelopes remain
`{params:{...}}`; per-tool typed schemas and descriptions are published by discovery.

## Large demos and deadlines

There is no pane-count cap. `DERP_ENGINE_TIMEOUT_MS` sets each worker request deadline (default 30000 ms). The Qt RPC transfer deadline is independently configurable with `DERP_REQUEST_TIMEOUT_MS` (default 300000 ms), allowing queued or multi-step operations. These are failure-detection deadlines, not pane-count suspension policies.

`bun tests/desktop/many-panes.ts` opens 50 real Chromium panes through MCP and Qt, clicks/inspects/captures every pane, switches demos, and checks reset on return. `DERP_TEST_PANES` changes the test count.
