---
name: derpdesign
description: Integrate local web projects into DerpDesign, create deterministic demos and mixed-engine panes, and use its MCP inspection and verification workflow. Use for DerpDesign workspaces, not ordinary standalone browser automation.
---

# DerpDesign

DerpDesign displays one active demo at a time. Panes can use Chromium or upstream Ladybird. There is no pane-count limit.

## Preserve the user’s desktop workflow

Creating or testing a demo in DerpDesign does not authorize opening its desktop, focusing a window/pane, changing the desktop selection, or restarting/closing the application. Use an isolated headless MCP host by default for implementation and verification. In that owned workspace, register demos, change selection, interact, reset, resize and capture autonomously. Existing desktop catalog reads are appropriate when needed; do not disturb its running demo.

Only operate the visible desktop when the user explicitly requests that action. Permission to open a demo once is not permission to close or restart the desktop later. Update a requested active demo under its existing ID with `demo_put`; do not create a copy merely because it is active. Pane-definition changes reload its scenario, while metadata-only changes preserve its live state. Do not change selection merely for inspection.

A connection failure is a debugging task, not authorization to run `derpdesign open`, relaunch, kill processes, or switch endpoints silently. Diagnose and fix DerpDesign connection/tooling defects when found; verify repairs in an isolated host. Read the recovery procedure in [CLI and windowless MCP](references/cli.md). If applying a verified repair requires disrupting the user’s desktop, finish the safe work first and request that specific action with the reason. Stop repeating a failed operation when it provides no new diagnostic evidence.

## Design and verification

When the user names an existing product as a reference, inspect its actual visual treatment and interaction before designing: screenshots/video, current documentation, and source where useful. Text-only feature documentation does not establish the UI. Identify what should match and what the task intentionally changes; do not make the user supply research you can obtain.

A demo should render the intended product interface. Do not add presentation labels, instructional footers, reset buttons, or extra toolbars unless requested. Keep scenario controls in the harness/CLI. Reuse the closest working component’s dimensions, spacing, colors, hover/focus states, and menu conventions before adding new styling. User corrections apply to every affected instance in the current design.

Verify the new behavior alongside the existing interactions it touches. A drag feature must preserve grouping/reordering and cancellation; a menu edit must preserve dismissal, focus, and separator consistency. Stateful mocks must implement the commands needed by those checks or fail explicitly, never silently succeed. Inspect the rendered result against the reference and accumulated corrections before handoff; successful input calls and compilation alone are not proof.

## Tools and integration

Discover the connected DerpDesign MCP tools first. For work spanning CLI calls, use `derpdesign session start`, retain its returned session file, and pass `--session FILE` to subsequent commands; stop only that session when finished. Use `derpdesign mcp --headless` for a connected stdio client. Both workflows use isolated state; neither opens the desktop. The CLI supports selector-based interaction sequences, inspection, screenshots and complete demo snapshots. Use `sequence --file` for repeatable behavioral checks and keep its versioned capture report as evidence. Read [CLI and windowless MCP](references/cli.md) for commands, ownership, display scale and state-directory behavior. The legacy `bun scripts/mcp-call.ts list` / `<tool_name> --file <JSON-file>` helper remains available. These paths use actual MCP; do not bypass it with workspace internals or desktop credentials.

Tool arguments have a `params` envelope. The helper accepts the inner params object. Inspect live tool schemas; do not guess required parameters. Call `engine_status` before promising an engine. Unavailable Ladybird is not permission to replace it with Chromium.

- For a new project or demo, read [integration.md](references/integration.md).
- For editing and verification, read [feedback-loop.md](references/feedback-loop.md).
- For host performance counters and isolated regression commands, read the performance diagnostics section of [cli.md](references/cli.md).

Inspect the selected project/demo in the intended host before changes. Changing selection disposes the previous demo; returning starts its declared scenario. `demo_put` accepts active demos: pane-definition changes reload that demo; metadata-only changes keep its live state. For an explicitly requested edit to the current desktop demo, update that same demo after isolated verification; do not present or focus the desktop. Ordinary source edits should not require rewriting project/demo declarations.

Inspection is read-only. Use pane input for clicks/typing/scrolling, never an arbitrary JS evaluation escape hatch.

Keep source code, build artifacts and demo evidence distinct. Never claim a capture proves a source revision unless capture completed successfully; compile/readiness errors and stale-capture errors must be fixed or reported. Engine doubles and canned screenshots are not product verification.
