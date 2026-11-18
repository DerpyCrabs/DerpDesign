"""Run independent diagnostics sequentially and preserve every failing exit status."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
catalog = Path(os.environ.get("DERP_TELEVECHA_CATALOG", root / ".local/workspace/state.json"))
gpu = [sys.executable, "tests/performance/headless-gpu.py", "bun", "tests/desktop/canvas-workflow.ts", "--gpu"]
suites = [("GPU fixture", gpu, {})]
if "DERP_TELEVECHA_CATALOG" in os.environ or (
    catalog.exists() and any(d["id"] == "televecha-message-gallery" for d in json.loads(catalog.read_text())["demos"])
):
    suites.append(("GPU Mission notebook", gpu, {"DERP_TELEVECHA_CATALOG": str(catalog.resolve())}))
    suites.append(("GPU Mission notebook 160%", gpu, {"DERP_TELEVECHA_CATALOG": str(catalog.resolve()),
                                                      "QT_SCALE_FACTOR": "1.6"}))
else:
    print("Mission notebook unavailable in local catalog. Running portable workloads.", flush=True)
for suite in ("canvas-workflow", "performance-metrics", "performance-native"):
    suites.append((suite, ["bun", f"tests/desktop/{suite}.ts"], {}))

suites.append(("Ladybird adapter idle", [sys.executable, "tests/ladybird/performance-idle.py"], {}))
suites.append(("Frame buffer read", ["build/desktop/frame-read-benchmark"], {}))

failures = []
for name, command, overrides in suites:
    env = os.environ.copy()
    env.pop("DERP_TELEVECHA_CATALOG", None)
    start = time.monotonic()
    print(f"Running {name}", flush=True)
    if name != "performance-native":  # The native input suite has its own supervisor.
        command = [sys.executable, "tests/performance/supervise.py", "180000", *command]
    result = subprocess.run(command, cwd=root, env=env | overrides)
    print(f"{name} finished in {time.monotonic() - start:.1f}s (exit {result.returncode})", flush=True)
    if result.returncode:
        failures.append(name)
if failures:
    sys.exit("Failed suites: " + ", ".join(failures))
