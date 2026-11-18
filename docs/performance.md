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
  generation frame updates, transferred pixel bytes and summed host loading time.
  For a cropped CEF update, these count only the patch payload and the time to
  read and apply it to the retained image.
  Invalid or stale frames are excluded. These are not capture/snapshot counts.
- dirtyBoundsBytes / dirtyBytes: enclosing rectangle and exact union area of
  CEF's accumulated damage, both in BGRA bytes. Their difference measures
  unchanged space between rectangles, including bounds covering a full pane.
- textureAllocations / textureStageBytes / fullTextureBytes / textureStageMs:
  Qt pane texture allocations, pixel bytes prepared for texture updates, their
  full-image equivalent, and CPU time spent preparing the texture update.
  The scene graph can defer submission for a culled node, so these are staging
  counters. On OpenGL, damage covering at least half a pane uses the full-image
  path. Small repaints reuse a BGRA texture on supported hardware. The threshold
  comes from comparing upload completion times on the 160% gallery workload.
  GPU execution time and bus traffic require separate instrumentation.
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

## Canvas regression suite

Build with testing enabled and run on Linux with Bun, Python, Sway, a working
GPU render node and both engine workers installed.

```sh
cmake -S apps/desktop -B build/desktop -DBUILD_TESTING=ON
cmake --build build/desktop --target desktop-native-tests frame-read-benchmark
bun run perf
```

The GPU runner starts Sway with a headless 1920×1080, 60 Hz output, an empty
private runtime directory, and its own configuration. Qt connects to that socket.
The test records Qt's actual graphics backend and adapter name, and rejects
software rendering. The four-pane fixture runs on every machine. When the local
catalog contains Mission notebook, the suite also loads its 12 live panes at
100% and 160% scale. Set `DERP_TELEVECHA_CATALOG` to use another trusted local
catalog. The harness starts the registered project command on a separate port.

| Workload | What the report measures |
| --- | --- |
| Open demo | Selection through successful content probes across all panes, including designated gallery panels |
| Idle | Host process CPU time, window swaps, engine frames and bytes over two seconds |
| Overview drag, wheel zoom, actual-size drag | 2.5 seconds of sustained Qt window input, swap rate, p95 and worst gap, estimated missed refreshes |
| Content clicks | Native input delivery, verified menu or message changes, engine request time, frame traffic and host CPU |
| Drag during incoming messages | Canvas frame pacing while the gallery processes new messages and publishes updated pixels |

Frame timestamps come from the render thread's Qt frame-swapped signal.
On drivers exposing GPU timestamps, `gpuMsPerFrame` averages completed GPU
frame durations reported by Qt during the gesture. It includes drawing and
resource updates, and is blank when the backend provides no samples.
A private output measures renderer pacing without a physical monitor or its
compositor. Raw frame bytes count successful host-side frame reads. Host CPU
covers threads of the Qt process. Engine request time sums completed requests
and can include concurrent work.

The suite prints a JSON report path for each GPU run. Startup budgets are
10 seconds for the fixture and 30 seconds for the gallery. Sustained gestures
must reach 80% of the output refresh rate and keep the p95 gap within two
refresh periods. Functional checks verify that the injected gestures move
the canvas and that browser updates reach the host. The suite also runs the
offscreen UI, MCP metrics, native input, adapter idle and frame buffer read
checks. Adapter idle and file read timings are informational.

For tighter same-machine regression checks, retain passing GPU reports in a
baseline directory as `canvas-workflow-1.json`, `televecha-message-gallery-1.json`
and `televecha-message-gallery-1.6.json`. Run
`DERP_PERF_BASELINES=/path/to/baselines bun run perf`. The comparator requires
matching workloads, renderer, dimensions, scale and refresh rate. It allows
25% variation plus an absolute margin of 500 ms for startup, 2 ms for p95 and
30 CPU ms per second for phase CPU usage. A missing or incompatible baseline
fails that run. Replacing a baseline is an explicit action.
