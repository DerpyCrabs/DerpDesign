# Chromium worker

The CEF worker uses sandboxed CPU offscreen rendering, isolated request contexts per pane, and raw BGRA frames with acknowledgements. Capture combines the view and active popup widget; dropdowns remain part of the pane image.

Viewport sizes and input/inspection coordinates are CSS pixels. Physical PNG/frame dimensions are ceil(CSS size × deviceScaleFactor). The pinned CEF build did not propagate custom GetScreenInfo density to its renderer in our Linux tests. The adapter therefore gives CEF a physical-size native surface at host scale 1 and applies isolated per-pane page zoom. Chromium rasterizes at that density; images are never enlarged afterward. Zoom is reapplied after navigation. Tests check actual innerWidth/innerHeight, devicePixelRatio, resolution media queries, CSS geometry and input. This models viewport density, not all properties of a real mobile device or operating-system display.

Readiness checks document/harness readiness, current CSS viewport and DPR, then waits for a new painted frame. Source-revision protection and evidence persistence are handled by the workspace service.

The entry point uses CEF's NO_STACK_PROTECTOR annotation because Chromium zygote children change their stack canary on fork. Sandboxing and stack protection elsewhere remain enabled. See https://github.com/chromiumembedded/cef/issues/3912.

Run `python3 tests/chromium/smoke.py` after building. It tests live BGRA, pointer/text input, selector/point read-only DOM/CSS inspection, arbitrary evaluation rejection, resize, simultaneous DPR 1/2/1.25 panes, select-popup composition and selection, and clean shutdown. PNG evidence is written under `/tmp/derp-chromium-*.png`.
