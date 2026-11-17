# Host frame buffer optimization

EngineManager retains the QFile read allocation in an immutable QImage with a
cleanup callback, instead of copying every pixel into another allocation.
QImage copies retain shared ownership, including scene graph readers. ACK remains
after complete file read; no worker mapping or file-backed borrowed pointer is
retained. Short reads are rejected and acknowledged without publishing a frame.
No density, pane-count, scheduling or capture policy changes.

Reproduction:

```
c++ -O2 -fPIC tests/desktop/frame-performance/read.cpp -o /tmp/derp-frame-read $(pkg-config --cflags --libs Qt6Gui)
flock /tmp/derpdesign-performance-benchmark.lock /tmp/derp-frame-read
cmake --build build/desktop -j 4
flock /tmp/derpdesign-performance-benchmark.lock bun tests/desktop/performance-native.ts
```

The microbenchmark compares file read plus pixel copy with retained-buffer ownership
and checks that a second QImage retains valid pixels after releasing the first.
It measures file-loading cost, not FPS, GPU memory or display latency.

`tests/desktop/performance-native.ts` exercises both engines, native input,
coalescing and repeated close/reopen cycles with an offscreen Qt canvas.
EngineSurface uses QImage cache keys to avoid uploads of unchanged images.
