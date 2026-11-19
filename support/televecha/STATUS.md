# TeleVecha integration status

Verified 2026-11-14 with real Chromium/CEF and pristine upstream Ladybird.
The external Vite entry imports the actual application, EffectWeb compiler,
styles and existing fixture transport. No integration-only target-source edits.

The fixture cache is substituted at appRuntime's module boundary with the
project's existing memory cache store. Demo state is local to the pane and resets
on reload. Debug-report checkpoint export deliberately fails as unsupported in
this fixture. Engines without Web Locks receive an explicit, per-pane mock of
the nonblocking exclusive lease used by the fixture; this does not emulate
cross-tab synchronization or establish native Web Locks support.

Verified: desktop/mobile Chromium rendering, real conversation switching,
actual-source edits with DOM/CSS/screenshots and exact restoration. Both engines
render and capture the real app; Ladybird conversation switching and source CSS
edit/restoration also passed. All evidence screenshots were inspected.

The Chromium native feedback test passed: user-created original annotation,
AI-only MCP source/evidence response, exact source restoration, then native user
resolution. Original feedback was preserved. Run `tests/desktop/feedback-loop.ts`
with its local registered seed, or use the integration drivers to create demos.

Evidence: `.local/verification/ladybird-projects-cac4bfc3-a199-4467-a170-4df4e009f902/evidence.json`,
`.local/verification/projects-mixed-6bd61d1d-42e5-4285-9673-16c489d0e560/evidence.json`.
Native original/review screenshots: `/tmp/derp-feedback-{original,reviewed}.png`.
These ignored local artifacts are run evidence, not committed fixtures.


Scenario expansion (verified offscreen at 160%): Three demos: original Alice conversation, conversation list (the actual application keeps its default conversation selected), and Release Channel with the target fixture transport long-channel-history route. Each has Chromium/Ladybird at 1200/390 widths. The list fixture closes the real details panel and opens the real mobile sidebar as needed. The harness waits for ready runtime; channel readiness accepts its real channel header rather than requiring a writable user composer. `tests/integration/scenarios.ts` supplies scenario DOM assertions and real pointer interactions. `bun test support/derp-media-server/scenarios.test.ts` checks declaration stability and shared mock contracts. All 12 panes passed condition assertions and real conversation/details interactions in `.local/verification/catalog-7044d138-731c-4ad8-a634-cc832fc72e3c/`. Initial and post-interaction captures were visually inspected; details checks assert the actual visible-layout class after the drawer animation, not merely a mounted hidden avatar.
