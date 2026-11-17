# Native engine worker transport v1

Each engine is a separately launched executable. stdin/stdout carry newline-delimited JSON. Diagnostics go to stderr. Commands/replies use the workspace engine envelope `{id,method,params,deadline}` and `{id,result}` / `{id,error:{code,message}}`. Qt groups Chromium panes in one worker using isolated request contexts, and launches one Ladybird Application worker/profile per pane because upstream jars are application-global. Mixed sessions combine all replies. A reusable Ladybird status probe owns no panes; closing a demo stops its pane workers and removes their profiles. No engine substitution.

Environment: DERP_FRAME_DIR (absolute ignored directory, owned by launcher). Worker creates generation-specific independent storage paths there. Version/build provenance must be returned by engine.status.

Supported methods: engine.status; session.open {generation,panes:[{id,url,viewport,conditions,...}]}; session.close {generation}; pane.input {generation,paneId,event}; pane.resize {generation,paneId,viewport}; pane.reset {generation,paneId}; pane.ready {generation,paneId}; pane.inspect {generation,paneId,selector?,point?,properties?}; pane.capture {generation,paneId}.

Capture returns {generation,engineVersion,pngBase64,inspection}. Inspection is an object containing DOM tree or selected element, computed styles, matched CSS where implemented, bounding rectangles and source information where available. Unsupported operations fail explicitly. No caller-controlled JS evaluation or mutation through inspection. Internal fixed readiness queries and data-bearing input operations are allowed.

## Live frames

Worker emits event (no id):
`{"event":"frame","paneId":"...","generation":1,"sequence":1,"width":800,"height":600,"stride":3200,"format":"BGRA8","path":"/absolute/owned/frame-1.bgra"}`

Pixels are premultiplied BGRA8, matching QImage::Format_ARGB32_Premultiplied on little-endian Linux. Fully write/close before emitting. Qt copies pixels into owned QImage and sends `{method:"frame.ack",params:{paneId,generation,sequence}}` (no reply required). Worker deletes the acknowledged file. Keep at most one unacknowledged published frame per pane; while waiting, retain only newest painted image and publish it upon ack. This is bounded transport backpressure, not a pane limit or engine suspension. No PNG/base64 continuous frame transport. A future shared-memory transport can replace files without changing session/inspection APIs.

The desktop sends `{method:"session.visibility",params:{visible:false}}` (no reply
required) when its window is hidden, minimized or unexposed. This is worker-wide
state and also applies to subsequently created panes. Chromium uses `WasHidden`;
Ladybird sets system document visibility. Both stop publishing and copying live
frames while suspended, and request a fresh paint on resume. Chromium also reduces
its message-pump wakeup rate while hidden. In-flight frames are still acknowledged
without reading their pixel files.

Pending automation requests temporarily keep their worker rendering, including
captures and inspections while the desktop is hidden. Completion, errors and
deadlines release that wakeup. Headless sessions stay rendering normally. Window
focus alone does not suspend rendering; workspace coverage depends on Qt's
platform exposure notifications. No compositor commands or settings are used.

Offscreen verification with both installed workers:

```sh
cmake --build build/desktop --target desktop-visibility-tests -j4
QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software DERP_HEADLESS=1 \
  DERP_CHROMIUM_WORKER="$PWD/.local/engines/chromium/build/derp-chromium" \
  DERP_LADYBIRD_WORKER="$PWD/.local/engines/ladybird/build-upstream/bin/derp-ladybird" \
  build/desktop/desktop-visibility-tests
```

Close deletes owned files and discards pending frames. Parent ignores frames from old generations. Paths must be within DERP_FRAME_DIR. Chromium OSR popups are composited into the pane image at their coordinates. Ladybird composites upstream select-menu items into the same live/captured image, using logical coordinates for input and DPR for painting. Inspection includes read-only `selectPopup` state (bounds, rows, highlight and scroll offset). Native canvas focus/mode/background changes dismiss the menu through the internal `pane.dismissPopup` command. Canvas zoom never alters viewport dimensions. Resize increments frame state and readiness must wait for a correctly sized completed paint.

## Readiness and errors

Harness sets window.__DERPDESIGN__ with ready/error/reset. For ordinary diagnostic fixtures without harness, successful document load plus completed paint is sufficient; report the readiness kind. Harness errors fail readiness/capture requests. Ladybird DOM/CSS inspection remains available while a harness is unready, exposing document state and harness stage/error for diagnosis. Capture waits for frame after readiness; detect navigation/resize/generation races. Worker honors deadlines and never reports successful capture before pixels exist. Background JS/HMR continues normally. Input uses CSS viewport coordinates (convert DPR internally).

Every engine implementation must include a standalone driver test that loads a deterministic HTTP fixture, clicks/types, inspects, resizes and captures. Test real engine; test doubles do not prove this contract.

Pointer input supports `move`, `down`, `up`, and `leave` (with viewport `x`/`y`; leave uses -1/-1). Hosts must send `leave` when the pointer exits a pane or interaction mode ends. Engines translate this to their native leave event, rather than an out-of-bounds move. Pointer motion must not acquire keyboard focus. Native UI input coalesces consecutive pending moves for the same pane while retaining click, key, wheel and leave ordering.
