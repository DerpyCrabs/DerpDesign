# Iframe removal regression

Run `python3 tests/ladybird/iframe-removal.py` against the built Ladybird worker.
The HTTP fixture and worker are isolated and stopped in `finally`.

The cases remove an iframe from a parent button, after focusing the iframe,
and from a child postMessage callback. They assert the remaining document,
sibling input, readiness and PNG capture after removal.

A large hidden text node exercises inspection replies larger than pipe capacity.
Ordinary and near-marker debug records must survive stderr filtering, while
reserved protocol records must not leak into logs. Nested frames exercise
chunked result transport and frame-relative inspection.

Results are written to `/tmp/derp-ladybird-iframe-removal.json`, with worker
stderr and before/after captures alongside it. The script exits nonzero on
inspection, input, capture or transport assertions.
