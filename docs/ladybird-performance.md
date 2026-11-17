# Ladybird adapter performance

The adapter runs its 5 ms retry timer only while deferred protocol requests
remain. Pending requests retain their ordering and deadlines. This avoids idle
wakeups when there is no work to retry.

```sh
python3 tests/ladybird/performance-idle.py
python3 tests/ladybird/frames.py
python3 tests/ladybird/popups.py
```

The idle benchmark launches an isolated offscreen adapter, waits two seconds,
and samples Linux process CPU ticks, voluntary context switches and RSS over
five seconds. It does not open a session, so it does not measure active-page
performance. Run benchmarks sequentially to avoid competing workloads.

Painting retains an owning QImage copy before returning the upstream buffer;
publication is acknowledgement-gated. Pointer input without a repaint does not
publish a duplicate frame. The frame and popup suites exercise real rendering,
input, capture, resize, multiple densities and session cleanup.

CPU samples are limited by clock-tick resolution, and RSS changes can be noise.
These tests do not establish input-to-photon latency or continuous-scroll FPS.
