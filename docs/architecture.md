# DerpDesign implementation contract

## Accepted product decisions

- Qt desktop UI; one selected project and one active demo canvas at a time.
- Demo selector has cached thumbnails updated after successful capture, not every frame.
- Panes can mix CEF Chromium and pinned upstream Ladybird. Use pristine upstream sources for the Ladybird worker.
- No hardcoded pane count or performance cap. 5–10 is an example workload, not a limit; 50 panes must be allowed. Resource policy must be observable and configurable, not silent count-based suspension.
- Switching demos disposes the old runtime; returning restarts its declared scenario. Inactive demos retain metadata and captures.
- External harnesses import actual target source. Integration must not edit target repositories. Application changes during the feedback loop are real target-source edits.
- Project support packages live with their target projects or in external directories; this repository keeps generic test fixtures only. Machine paths, database, artifacts, caches and builds are ignored local state.
- Static fixtures and interactive stateful mocks both supported. Harness lifecycle includes startup, mount, readiness, reset and cleanup.
- MCP is the only AI integration; T3 Code in another window uses it. AI may register projects, create demos, activate them and interact without selection approval.
- Inspector is strictly read-only: DOM, matched/computed CSS, box geometry, logs, source references. No editable CSS/DOM, arbitrary inspector console or debugger mutations.

## Boundaries

Qt canvas and inspector; workspace orchestration/MCP; per-project TypeScript harnesses; engine-specific worker adapters. Engine APIs normalize navigation, viewport, input, inspection and capture while reporting unsupported features. Engine workers use pinned upstream builds. Chromium groups isolated browser contexts in one worker. Ladybird uses one application process/profile per pane because its upstream cookie and storage jars are application-global; this costs more memory but preserves independent scenarios. Demo disposal terminates those workers and removes their profiles.

Evidence records source fingerprint including uncommitted edits, harness revision, engine version, scenario, viewport and run generation. Await compilation, scenario readiness and completed paint; never infer readiness solely from network idle. Detect captures racing updates.

Canvas zoom scales surfaces without altering CSS viewport. Keep pane browser storage/mock state independent.

## Verification gates

1. Real upstream Ladybird and CEF surfaces in Qt, including input, resizing and capture.
2. Generic fixtures rendered in both engines without sibling project dependencies.
3. Read-only DOM/CSS inspector.
4. MCP registration, demo creation/selection, input, fresh evidence.
5. Exercise fixture updates, replay, inspection and capture through MCP.
6. Exercise more than ten panes; no count-based rejection. Measure rather than invent performance claims.
