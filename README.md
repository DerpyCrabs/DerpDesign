# DerpDesign

Native Qt canvas for local project demos, browser-engine comparison and AI inspection and verification through MCP.

## Arch Linux installation

From this checkout, with Bun on PATH, run `makepkg -si`. The package builds both pinned renderers and installs the DerpDesign application menu entry and the `derpdesign` CLI. If both renderer build trees are already configured in this checkout, use `DERPDESIGN_PACKAGE_REUSE_BUILD=1 makepkg -si` to reuse them.

Launch from the menu or run `derpdesign open`. The installed app keeps its catalog, canvas settings and sessions under `${XDG_DATA_HOME:-$HOME/.local/share}/derpdesign`. Development runs use the checkout’s `.local/` directory.

## Development

```sh
bun install
bun run desktop:configure
bun run desktop:build
bun run start
```

Desktop launch returns once the app is ready. The app runs independently of the launching terminal; close its window to stop it. Startup output includes the retained diagnostic log path under `.local/desktop/`.


Requires Qt 6 Core/Gui/Quick/QuickControls2/Network/WebSockets development packages, CMake and a C++20 compiler. Engine setup is separate: `scripts/setup-cef.sh` provisions CEF; `scripts/setup-ladybird --build` provisions and builds clean pinned upstream Ladybird, together with its external worker. See engine directories for current build state. `DERP_CHROMIUM_WORKER` and `DERP_LADYBIRD_WORKER` can specify worker executables. Missing engines are reported, never substituted.

The launcher starts the shared workspace and desktop. Agent credentials are generated locally, never committed. Local data and evidence live in `.local/`. The desktop owns browser workers; closing it shuts down project servers.

## Canvas workflow

Choose a project and demo in the header. **Fit all** shows the demo overview; a pane's **100% ↗** button focuses it at actual size in the screen’s coordinate scale, keeping every other pane on the canvas. The pane selector also focuses without hiding panes. **Fit pane** frames the selected pane without changing its declared viewport.

In the compact floating tool dock, **Pointer** sends hover, clicks and keyboard input to the app by default and drags pane headers; **Pan** moves the canvas, and **Inspect** picks HTML/CSS. The read-only inspector docks to the right and has a draggable divider. Pick mode highlights hovered elements; click selects a node in the expandable Elements tree with Styles and Computed tabs. Same-origin nested frames are supported in Ladybird; cross-origin frames remain boundaries. Workspace updates arrive automatically.

Shortcuts outside app/text input: V/P Pointer, H Pan, I Inspect, 1 actual size, Shift+1 fit all. Ctrl+wheel zooms; middle-drag pans. Tooltips name the tools and shortcuts.

## CLI and windowless MCP

```sh
bin/derpdesign session start --scale 1.6
# Use the session file returned by start for subsequent calls.
bin/derpdesign call project_list --session /absolute/session/session.json
bin/derpdesign sequence --session /absolute/session/session.json --pane fixture-wide --file checks.json --out report.json
bin/derpdesign session stop --session /absolute/session/session.json
bin/derpdesign mcp --headless --scale 1.6
```

Persistent sessions run without a window and survive individual CLI calls; stop cleans up their owned host and project server. Stdio MCP owns cleanup on client EOF/signals instead. Both use isolated state, seeded with the desktop catalog. Concurrent sessions need separate state directories and dev-server ports. `sequence` uses selector-based native input and assertions, returning versioned initial/final captures and failure evidence. Existing captures already carry source/harness fingerprints.

A normal desktop launch (including `derpdesign open`) restores the last project, demo, pan and zoom from its state directory. An explicit launch target or MCP selection opens the requested demo in its default overview.

Use `open --project ID --demo ID --pane ID` only when a visible desktop action is requested. It may launch a window or change selection; it is not a connection recovery command. Reusing an existing window does not raise or activate it, and keeps its canvas position. `--pane` sets the initial pane only when starting a new desktop. Do not stop the user's desktop or take over its state directory for verification.

[Complete CLI and sequence reference](skills/derpdesign/references/cli.md). Tests: `bun tests/cli/session-sequence.ts` checks real Chromium/Ladybird input, failure evidence and persistent cleanup. Existing tests: `bun tests/cli/verify.ts`, `bun tests/cli/open.ts`, `bun tests/cli/lifecycle.ts`. All use isolated state and no visible windows.

## T3 Code MCP connection

Configure a self-contained stdio MCP server with command `/absolute/path/to/DerpDesign/bin/derpdesign` and arguments `["mcp", "--headless", "--scale", "1.6"]`. To attach to an existing desktop instead, use arguments `["mcp"]` (the legacy `bun scripts/mcp.ts` bridge also works). The bridge reads the local agent credential and connects to the running workspace.

Use the [DerpDesign skill](skills/derpdesign/SKILL.md) to integrate a project or run the verification workflow. For a direct diagnostic using the same MCP transport:

```sh
bun scripts/mcp-call.ts list
bun scripts/mcp-call.ts engine_status
bun scripts/mcp-call.ts project_register --file /path/to/project-params.json
```

## Current verification

The following checks use real engines unless identified as workspace tests:

- `bun test packages`: workspace/MCP permissions, persistence, stale captures, stdio forwarding and process cleanup.
- `python3 tests/chromium/smoke.py`: Chromium rendering, input, inspection, mixed density and select popup composition.
- `python3 tests/ladybird/frames.py`, `python3 tests/ladybird/density.py`, and `python3 tests/ladybird/lifecycle.py`: upstream rendering, input, read-only inspection, resize, mixed density, close/reopen, deadlines, readiness errors and renderer crashes.
- `python3 tests/ladybird/popups.py` and `bun tests/desktop/select-popups.ts`: select-menu composition/capture, grouped and disabled options, keyboard/pointer interaction, scrolling, dismissal, and DPR scaling.
- `bun tests/desktop/inspector.ts`: docked Elements tree, hover highlighting, selection, styles and nested Ladybird frame picking at 160% display scale.
- `bun tests/desktop/mixed-engines.ts`: both engines together in Qt, with MCP pointer input, DOM/CSS inspection and captures.
- `ctest --test-dir build/desktop --output-on-failure`: mocked native interaction test, using offscreen software rendering. Real browser/workspace suites run separately through the integration runners below.
- `bun tests/desktop/storage-isolation.ts`: same-origin Ladybird pane storage isolation, profile cleanup and demo reset through real Qt/MCP.
- `bun tests/desktop/canvas-workflow.ts`: generic fixture styles, native hover/menu interaction in both engines, screen-relative 100% scaling (also run with `QT_SCALE_FACTOR=1.6`), overview, inspection, panning, and 1280/1380/2000px layouts.
- `bun tests/desktop/many-panes.ts`: 50 real Chromium panes, interaction/capture in each, demo switching and scenario reset. There is no pane-count cap.

Ladybird's matched rules cover readable author CSS, with unsupported rule groups reported. Ladybird panes run in separate worker processes with fresh profiles: same-origin cookie, localStorage and sessionStorage isolation, plus reset after switching demos and returning, are verified through Qt/MCP. Each pane adds an application process and its services, increasing memory use and startup cost.

See [architecture](docs/architecture.md), [workspace protocol](docs/protocol.md), and [worker protocol](docs/worker-protocol.md) for the accepted contract.

`python3 tests/chromium/host-loss.py` verifies EOF shutdown with live panes; `bun tests/desktop/host-loss.ts` checks idle CPU on a static mixed-engine demo and verifies all engine descendants exit after abrupt host death.

## Test fixtures

The repository contains only generic test demos under `tests/`: small HTML pages for input, menus, nested frames, storage isolation, canvas navigation and performance diagnostics. They run without sibling application checkouts. Project-specific demos and adapters belong in the target project's repository; register their declarations through MCP with an external `supportRoot`.

See [Ladybird diagnostics](docs/ladybird-diagnostics.md) for adapter responsibilities, MCP limits and upstream bug triage.

## Performance regression checks

`bin/derpdesign call performance_snapshot` reads bounded per-pane host counters. See [diagnostic semantics](docs/performance.md): summed durations and next-frame observations are not screen presentation latency.

- `bun tests/desktop/performance-native.ts`: deterministic real-engine native queue accounting.
