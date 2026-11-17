"""Bound an owned test process tree, including workers creating their own sessions."""
import ctypes, os, signal, subprocess, sys, time
limit = int(sys.argv[1]) / 1000
# Adopt orphaned grandchildren so engine workers remain owned after a parent dies.
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER failed')
p = subprocess.Popen(sys.argv[2:], start_new_session=True)
owned = {}
def discover():
    rows = {}
    for name in os.listdir('/proc'):
        if not name.isdigit(): continue
        try:
            with open('/proc/'+name+'/stat') as f: fields=f.read().rsplit(')',1)[1].split()
            rows[int(name)] = (int(fields[1]), fields[19], fields[0])
        except (FileNotFoundError, ProcessLookupError): pass
    parents = {os.getpid()}
    changed = True
    while changed:
        changed = False
        for pid,(parent,start,state) in rows.items():
            if parent in parents and pid not in parents:
                parents.add(pid);owned[pid]=start;changed=True
    return [pid for pid,start in owned.items() if pid in rows and rows[pid][1]==start and rows[pid][2]!='Z']
def terminate(sig):
    for pid in discover():
        try: os.kill(pid,sig)
        except ProcessLookupError: pass
end=time.monotonic()+limit
code=124
try:
    while time.monotonic()<end:
        discover()
        value=p.poll()
        if value is not None: code=value;break
        time.sleep(.02)
finally:
    terminate(signal.SIGTERM)
    grace=time.monotonic()+3
    while discover() and time.monotonic()<grace: time.sleep(.02)
    terminate(signal.SIGKILL)
    p.wait(timeout=5)
    end=time.monotonic()+5
    while discover() and time.monotonic()<end: time.sleep(.02)
    survivors=discover()
    while True:
        try:
            if os.waitpid(-1,os.WNOHANG)[0]==0: break
        except ChildProcessError: break
    print({'supervisor':'cleanup','worker':p.pid,'survivors':survivors},flush=True)
    if survivors: code=125
sys.exit(code)
