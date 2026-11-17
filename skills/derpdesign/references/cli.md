# CLI and windowless MCP

The executable is `derpdesign` (repository fallback: `bin/derpdesign`, or `bun scripts/cli.ts`). Use `derpdesign --help` for current flags. All CLI operations use the same authenticated MCP tools as agents.

## Persistent isolated sessions

```sh
derpdesign session start --scale 1.6
# Use the returned session file for every subsequent call:
derpdesign session status --session /absolute/session/session.json
derpdesign call project_list --session /absolute/session/session.json
derpdesign session stop --session /absolute/session/session.json
```

`start` returns the session file, MCP URL, state directory and log path after the headless engine host connects. It survives individual CLI invocations without needing a long-lived stdio client. It selects no demo. The default is a fresh directory under `.local/sessions/`; `--state-dir` can name a separate task workspace. The desktop state directory is refused. Catalogs are initially copied, but dev-server ports still need to be made distinct via `project_update` in the isolated session before activation.

The session file contains a local control credential and is mode 0600; do not print its contents or commit it. `--session` checks that the owned host is reachable and cannot be combined with another endpoint. Stop uses the session’s authenticated control endpoint, waits for owned processes to exit, and removes its record. An unreachable session reports its log path; it never guesses a PID to kill, opens a desktop, or restarts a host. Keep the state directory for captures and diagnosis.

## Repeatable interaction sequences

```sh
derpdesign sequence --session /absolute/session/session.json --pane bird-wide --file checks.json --out report.json
```

`checks.json` contains `{"steps":[...]}`. Supported steps:

```json
{"steps":[
  {"action":"click","selector":"[aria-label=Tabs] button","button":"right"},
  {"action":"assert","selector":".tab-menu","contains":"Duplicate tab"},
  {"action":"key","key":"Escape"},
  {"action":"drag","from":{"selector":"#first-tab"},"to":{"selector":"#second-tab","x":0.5,"y":0.5}},
  {"action":"assert","selector":"#second-tab","styles":{"display":"flex"}},
  {"action":"type","selector":"input[name=notes]","text":"Review note"},
  {"action":"capture","label":"group-created"}
]}
```

Selectors must resolve to one visible element for actions. Drag endpoints accept fractional `x`/`y` within bounds (default center); frames use a `framePath` selector array. `type` focuses and inserts literal text without clearing it; use explicit key steps for selection/deletion. Assertions support `exists`, exact `text`, `contains`, computed `styles`, and bounded `timeoutMs` (default 3000, maximum 30000). Native input is used throughout; no JavaScript is injected into the page.

The runner waits for harness readiness through an initial capture, checks selection generation before input, and captures final evidence. Reports contain step results and versioned capture IDs/paths with source/harness fingerprints. Failures identify the step, return nonzero, and attempt a failure capture. Source or demo changes invalidate the run. Inspect the captured images yourself; assertions do not establish visual quality. Keep the report distinct from source and use `snapshot` when a portable bundle is needed.

## Open or focus the desktop — only when explicitly requested

Creating a demo alone does not authorize this command. `open` can launch a visible application and replace the current selection; it is never a connection probe or recovery command.

```sh
derpdesign open --project fixture --demo fixture-demo --pane fixture-ladybird
```

`open` reuses the local instance when available without raising or activating its window. On reuse it keeps the current canvas position; `--pane` only sets the initial pane when starting a new desktop. Selecting the already-active demo preserves its running state. On initial launch, `--pane` centers that pane at 100% without hiding others. With no running host, `open` starts a detached desktop supervisor and returns after selecting the demo. Closing the launching terminal or terminating the command does not close the app. Close the application window to stop its supervisor and owned engines. Per-launch diagnostics are retained under `.local/desktop/run-*/desktop.log`. An existing headless host cannot display a canvas; use a separate desktop endpoint. Existing older desktop builds must be restarted by the user before newly added CLI tools work. Do not open, focus, close, or restart visible windows without an explicit request for that action. A prior launch request does not authorize a later restart.

`--url http://127.0.0.1:PORT/mcp` targets an existing host. A newly launched desktop can use `--port PORT --state-dir DIRECTORY`. An explicitly supplied endpoint is never silently replaced by a new host.

## Inspect and export

```sh
derpdesign inspect --pane bird-wide --selector '.toolbar'
derpdesign inspect --pane bird-wide --point 120,80 --properties color,width,height
derpdesign inspect --pane fixture-ladybird --selector button \
  --frame-path '["iframe[title=\"Library\"]","iframe"]' --out inspection.json
derpdesign screenshot --pane bird-wide --out pane.png
derpdesign snapshot --demo fixture-demo --out ./review-snapshot
```

Use actual registered IDs from `derpdesign call project_list` / `derpdesign call demo_list`. `inspect` outputs JSON; screenshots output PNG plus capture metadata on stdout. Snapshots require a new output directory and include every pane's PNG/inspection JSON, demo/project declarations, conditions, engine versions and source/harness fingerprints in `snapshot.json`. The manifest is written only after all captures succeed and selection/source consistency checks pass. A directory without the manifest is incomplete. This is pane evidence, not a screenshot of the surrounding Qt canvas. Console/network/performance histories remain unsupported.

`call TOOL --file params.json` passes the inner params object (no extra `params` envelope). It supports existing input, reset, and registration tools. Invalid commands/tool failures exit nonzero. `--demo` can infer its project; `--project` requires `--demo`.

## MCP without a window or display server

Configure a stdio MCP server with this executable and arguments:

```text
derpdesign mcp --headless --scale 1.6 --state-dir /absolute/task-specific/state-directory
```

Or use the absolute repository `bin/derpdesign` path in MCP client configuration. It launches an owned workspace service and Qt engine host **without loading the QML canvas or creating a window**. Chromium uses its headless Ozone backend. Both Chromium and Ladybird support real input, rendering, inspection and capture in this mode. Scale defaults to 1; `--scale` supplies the display scale for panes declaring `deviceScaleFactor: "display"`. Numeric pane DPR remains explicit.

The default headless state directory is `.local/headless`. On its first run, it copies the desktop's project/demo catalog, not captures; subsequent runs retain its own state. `--state-dir DIRECTORY` isolates another workspace. Do not point an automated headless session at the desktop state directory or stop the desktop to acquire it. Each directory is locked while owned. Headless and desktop sessions do not share running selections or browser state. Project dev-server ports still come from declarations: give concurrent sessions distinct project server ports if necessary. Existing isolated catalogs are not automatically synchronized with later desktop catalog changes; register/update them through MCP. When delivering a demo, retain its declaration and source so it can be registered as an inactive demo in the desktop catalog through MCP without selecting it. Do not copy workspace internals to publish it.

Optional startup selection: `--project ID --demo ID`. Use `--port PORT` if a separate CLI process should connect with `--url http://127.0.0.1:PORT/mcp`; otherwise the owned service chooses a free port. Only MCP protocol goes to stdout; diagnostics go to stderr. EOF/client disconnect or SIGINT/SIGTERM stops the owned host, browser workers and project server. Never point simultaneous runtimes at the same state directory.

`derpdesign mcp` without `--headless` is a stdio bridge to an existing desktop/host, just like the legacy `scripts/mcp.ts`. It does not own or terminate that host.

## Connection failure: diagnose and repair

1. Record the exact failing command/tool, endpoint, error, host ownership, and exit status. Check the MCP client configuration, endpoint discovery, process/listener state and available host logs with read-only tools. A refused connection alone does not establish why the host stopped or who stopped it.
2. Inspect DerpDesign’s CLI/MCP transport and host lifecycle code where the evidence points. Check for stale endpoint discovery, wrong ports, startup failures, client disconnect handling, and process ownership. Do not repeatedly retry the same call or substitute `open` for diagnosis.
3. Fix a demonstrated DerpDesign defect within the authorized task, preserving unrelated changes. Reproduce and verify it using a task-owned headless host, separate state directory, and distinct service/dev-server ports. Keep the stdio client alive while using its owned host: EOF/disconnect stops that host. Explicitly pass the isolated endpoint to subsequent CLI calls so they cannot fall back to the desktop.
4. Stop/restart only the isolated host you own as needed for verification. Do not kill a desktop or a process occupying a port; use a different isolated port. If no safe repair is possible without a desktop restart or another user action, report the diagnosis and prepared fix, explain the remaining step, and request that specific action. Do not claim repair before verifying the failing operation.

## Performance diagnostics

`derpdesign call performance_snapshot` reads bounded host counters for active panes. Compare snapshots only within the same generation. Native received/sent/coalesced counters describe desktop input; MCP input does not increment them. Frame counters report delivered BGRA bytes and file read/copy time. Duration fields are sums in milliseconds, not percentiles. `observationalNextFrameMs` measures the first received frame after the latest input dispatch; animations can satisfy it, so it is neither causal input latency nor screen presentation time. CPU/RSS require external process sampling. Session changes clear counters.

Repo regressions: `bun tests/desktop/performance-native.ts` exercises real Qt input offscreen at 160% using a deterministic fixture to check coalescing and lifecycle cleanup. It owns its runtime; do not run against the user's active workspace.
