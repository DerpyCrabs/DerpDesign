"""Compare two successful hardware reports from the same runner."""
import json
import sys
from pathlib import Path

def read(path):
    report = json.loads(Path(path).read_text())
    phases = {phase["phase"]: phase for phase in report["phases"]}
    return report, phases

baseline, old = read(sys.argv[1])
candidate, new = read(sys.argv[2])
if (baseline["demo"], baseline["panes"], old.keys()) != (candidate["demo"], candidate["panes"], new.keys()):
    sys.exit("Incompatible workloads")
failures = []
def check(label, measured, reference, margin):
    limit = reference * 1.25 + margin
    if measured > limit:
        failures.append(f"{label}: {measured:.1f} exceeds {limit:.1f} (baseline {reference:.1f})")

check("startup ms", candidate["startupMs"], baseline["startupMs"], 500)
for name, phase in new.items():
    reference = old[name]
    if "device" in reference:
        if any(phase[k] != reference[k] for k in ("device", "width", "height", "refreshHz", "scale")):
            sys.exit(f"Incompatible renderer or display for {name}")
        check(f"{name} p95 ms", phase["p95Ms"], reference["p95Ms"], 2)
    check(f"{name} host CPU ms/s", 1000 * phase["hostCpuMs"] / phase["durationMs"],
          1000 * reference["hostCpuMs"] / reference["durationMs"], 30)
print("\n".join(failures) or "Within performance baseline")
sys.exit(bool(failures))
