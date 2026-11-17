#!/usr/bin/env python3
"""Measure adapter idle CPU and voluntary context switches; no native windows."""
import os,pathlib,subprocess,tempfile,time,json
root=pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as d, open(os.devnull,'w') as log:
 p=subprocess.Popen([str(root/'.local/engines/ladybird/build-upstream/bin/derp-ladybird')],stdin=subprocess.PIPE,stdout=log,stderr=log,env={**os.environ,'DERP_FRAME_DIR':d})
 try:
  time.sleep(2)
  def sample():
   stat=pathlib.Path(f'/proc/{p.pid}/stat').read_text().split()
   status=dict(line.split(':',1) for line in pathlib.Path(f'/proc/{p.pid}/status').read_text().splitlines() if ':' in line)
   return sum(map(int,stat[13:15]))/os.sysconf('SC_CLK_TCK'),int(status['voluntary_ctxt_switches']),status['VmRSS'].strip()
  a=sample();time.sleep(5);b=sample()
  print(json.dumps(dict(seconds=5,cpu_seconds=b[0]-a[0],voluntary_switches=b[1]-a[1],rss=b[2])))
 finally:
  p.stdin.close();p.wait(timeout=15)
