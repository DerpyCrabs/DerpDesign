# Interactive host diagnostics

MCP tool: `performance_snapshot`, internal method `performance.snapshot`.
Arguments: `{"params":{}}`. No reset option. Read-only; disconnected Qt host is
an error ("Qt host disconnected"). CLI generic call:
`bin/derpdesign call performance_snapshot` (use `--url` to target an isolated host).
An isolated `bin/derpdesign mcp --headless --state-dir /tmp/unique-directory`
exposes the same tool without a window.

The response contains generation, windowVisible, panes keyed by active pane ID, durationUnit
(milliseconds), and latencySemantics. Storage is constant per active pane:
counters and duration sums only, no event histories or pane cap. Session open
and close clear metrics. Fields are sparse until observed.

- nativeInputReceived: accepted native UI calls; nativeInputCoalesced:
  consecutive queued pointer moves replaced; nativeInputSent: dequeued calls.
- nativeInputPending: currently queued native calls, excluding the in-flight
  HTTP request. MCP input does not increment native counters.
- nativeQueueWaitMs: summed monotonic time from latest queued event to dequeue.
- engineRequests / engineRequestMs: completed pane worker requests and summed
  elapsed time, including error/timeout completion.
- framesReceived / frameBytes / frameReadCopyMs: successfully loaded current
  generation frames, raw pixel bytes and summed frame-loading time (file read and QImage setup).
  Invalid or stale frames are excluded. These are not capture/snapshot counts.
- framesSkippedHidden: current-generation in-flight frames acknowledged without
  reading pixels while the desktop window is unexposed. Hidden automation may
  produce these frames during its temporary worker wakeup. `windowVisible` is
  true for headless sessions, which do not use window-driven suspension.
- observationalNextFrameSamples / observationalNextFrameMs: first successfully
  loaded frame after latest worker input dispatch. Multiple inputs before a
  frame replace the timestamp. This is observational, not causal latency and
  not display presentation; unsolicited frames can satisfy the observation.

No engine CPU or memory values are invented. Measure process CPU/RSS externally.
No percentile estimates are exposed. Host thread scheduling, IPC and frame
publication affect observations. Native pending excludes in-flight work.

Verification:

- `bun tests/desktop/performance-metrics.ts`: MCP discovery, request completion,
  frame bytes, timing semantics and metrics reset through an isolated Qt host.
- `bun tests/desktop/performance-native.ts`: real Chromium and Ladybird input
  through offscreen Qt at 160%, queue coalescing and repeated close/reopen.

`DERP_NATIVE_SUITE_TIMEOUT_MS` controls the positive integer supervisor deadline
(default 180000 ms). The Linux subreaper supervisor cleans owned descendants,
including workers creating separate sessions.

Limits: next-frame intervals are not input-to-photon measurements. No presentation
clock, full console/network history, animation benchmark, or upstream-browser
comparison is included. CPU/RSS samples exclude workspace and project servers.
No claim of perfect UX, visual parity, or complete performance coverage follows
from these regression checks.
