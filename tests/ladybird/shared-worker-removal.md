# SharedWorker lifetime diagnostic

This exploratory reduction launches pinned upstream `Ladybird --headless=manual`
directly, without the DerpDesign worker or desktop. It serves plain HTML and a
SharedWorker over a temporary loopback server. Processes, profiles and the server
are cleaned up after each run.

```sh
python3 tests/ladybird/shared-worker-removal.py cycle remove-cycle
python3 tests/ladybird/shared-worker-removal.py websocket-close
```

Other modes are `remove`, `later` and `hide`. Each runs for five seconds and
records worker construction, replies, visibility cycles and parent survival in
`/tmp/ladybird-shared-worker-removal/results.json` and per-mode logs.

The default `websocket-close` mode attempts to construct a blob SharedWorker
from a removed iframe's retained WebSocket close callback. Its initial validation
did not establish the WebSocket connection, so that callback remains unverified.
The simpler removal and visibility cases did not reproduce the investigated
crash. These observations are not proof that all detached-document worker
lifetimes are safe; this script is not a passing regression gate for that issue.
