"""Run inside a private GPU-backed Wayland output, without a desktop connection."""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="derp-gpu-") as directory:
    runtime = Path(directory)
    config = runtime / "sway.conf"
    config.write_text("output * mode 1920x1080@60Hz\nxwayland disable\nfor_window [title=^DerpDesign$] fullscreen enable\n")
    env = os.environ.copy()
    for key in ("DISPLAY", "WAYLAND_DISPLAY", "WAYLAND_SOCKET", "SWAYSOCK",
                "I3SOCK", "QT_QUICK_BACKEND", "QT_QPA_PLATFORMTHEME"):
        env.pop(key, None)
    env.update(XDG_RUNTIME_DIR=directory, WLR_BACKENDS="headless",
               WLR_HEADLESS_OUTPUTS="1", WLR_LIBINPUT_NO_DEVICES="1",
               QT_QPA_PLATFORM="wayland")
    with open(runtime / "compositor.log", "w+") as log:
        compositor = subprocess.Popen(["sway", "--unsupported-gpu", "-c", str(config)],
                                      env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                sockets = [p for p in runtime.glob("wayland-*") if p.is_socket()]
                if sockets:
                    break
                if compositor.poll() is not None:
                    break
                time.sleep(0.1)
            if not sockets:
                log.seek(0)
                sys.exit("Private compositor failed to start:\n" + log.read())
            env.update(WAYLAND_DISPLAY=sockets[0].name, DERP_GPU_RUNTIME=directory)
            sys.exit(subprocess.run(sys.argv[1:], env=env).returncode)
        finally:
            if compositor.poll() is None:
                compositor.terminate()
            compositor.wait(timeout=5)
