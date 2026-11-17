#!/usr/bin/env python3
"""Closing the host pipe must terminate CEF with live panes, without a close RPC."""
import json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
for attempt in range(3):
 with tempfile.TemporaryDirectory() as directory:
  with open(pathlib.Path(directory)/'stderr.log','w') as log:
   proc=subprocess.Popen([str(ROOT/'.local/engines/chromium/build/derp-chromium')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'DERP_FRAME_DIR':directory})
   messages=queue.Queue()
   def reader():
    for line in proc.stdout:
     try:messages.put(json.loads(line))
     except ValueError:pass
   threading.Thread(target=reader,daemon=True).start()
   try:
    proc.stdin.write(json.dumps({'id':'open','method':'session.open','params':{'generation':1,'panes':[{'id':'p','url':'data:text/html,<button>host loss</button>','viewport':{'width':400,'height':300,'deviceScaleFactor':1.6}}]}})+'\n');proc.stdin.flush()
    deadline=time.monotonic()+20
    while True:
     assert time.monotonic()<deadline,'No frame before host-loss test'
     message=messages.get(timeout=max(.01,deadline-time.monotonic()))
     if message.get('event')=='frame':break
    # No session.close and no frame acknowledgement: simulate a lost host.
    proc.stdin.close()
    assert proc.wait(timeout=8)==0
    print('PASS EOF with live pane and outstanding frame',attempt+1)
   finally:
    if proc.poll() is None:proc.kill();proc.wait()
