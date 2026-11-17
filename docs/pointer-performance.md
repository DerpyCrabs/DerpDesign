# Pointer ownership and frame work

The desktop previously sent an out-of-bounds move when leaving a pane. Both workers treated it as ordinary motion and acquired keyboard focus on every event. Ladybird additionally published its previous full bitmap for every input, before the resulting repaint. The desktop fetched workspace state after every input reply.

The workers now receive native pointer leave events. Motion does not acquire keyboard focus. The canvas clears browser hover on exit, cancellation, tool change and window deactivation. Consecutive queued motion is coalesced; intervening button, key, wheel and leave events retain their order. Input and inspection replies no longer fetch workspace state. Ladybird publishes on paint or popup interaction, and does not copy a bitmap just to compose an absent popup.

Verification commands:

- `bun tests/desktop/hover.ts`: real Qt pointer routing and both real engines at 160%; hover in unselected panes, exit to canvas, tool changes, burst motion followed by click and leave. Uses offscreen Qt.
- `python3 tests/ladybird/frames.py`: real rendering, resize, input, capture and lifecycle; 100 unchanged moves must not produce a frame per move. Measured zero frames in both session generations, about 1.6 seconds for 100 sequential requests.

No visible desktop restart is performed by these checks. Running desktop processes need a restart to load the rebuilt host and workers.

Input queued by the desktop carries `expectedGeneration`. Closing a session disables input and empties pending native events. The workspace discards explicitly generation-bound stale input before resolving a pane, including when the new demo reuses the pane ID. Calls without a generation still report invalid pane references normally. The native hover test closes a hovered demo during motion, verifies no error banner, reopens it and verifies input works again.
