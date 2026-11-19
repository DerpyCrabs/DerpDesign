# Ladybird worker

The worker links to pristine upstream Ladybird commit
`22ab1ff0ea76ff948caf1145f87f49431e7f6cc3` through an external CMake adapter.
It uses LibWebView/WebContent for rendering and runs a separate process and
storage profile for each pane. No upstream source patches are applied.

## Build

From the repository root:

```sh
scripts/setup-ladybird --build
```

The setup script verifies the upstream archive checksum and source tree, installs
pinned vcpkg dependencies, and builds under `.local/engines/ladybird/`.
`LADYBIRD_JOBS` controls build parallelism (default four). The adapter executable
is `.local/engines/ladybird/build-upstream/bin/derp-ladybird`.

The worker supports BGRA frame publication and acknowledgements, input, resize,
readiness, reset, PNG capture, select popups and read-only DOM/CSS inspection.
See [worker protocol](../../docs/worker-protocol.md) and
[inspection limitations](../../docs/ladybird-diagnostics.md).

## Verification

```sh
python3 tests/ladybird/frames.py
python3 tests/ladybird/density.py
python3 tests/ladybird/popups.py
python3 tests/ladybird/lifecycle.py
python3 tests/ladybird/iframe-removal.py
```

Tests use generic local fixtures and isolated worker profiles. Host Fontconfig
warnings can occur with the pinned dependencies. The adapter uses internal
upstream APIs; changing the engine pin requires rebuilding and revalidating it.
