#!/usr/bin/env python3
"""Plain upstream Ladybird --headless=manual; no DerpDesign worker or desktop."""
import http.server,json,os,pathlib,signal,subprocess,tempfile,threading,time,sys,hashlib,base64
ROOT=pathlib.Path(__file__).resolve().parents[2]
output=pathlib.Path('/tmp/ladybird-shared-worker-removal');output.mkdir(exist_ok=True)
events=[]
close_socket=threading.Event()
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/socket':
   accept=base64.b64encode(hashlib.sha1((self.headers['Sec-WebSocket-Key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
   self.send_response(101);self.send_header('Upgrade','websocket');self.send_header('Connection','Upgrade');self.send_header('Sec-WebSocket-Accept',accept);self.end_headers();self.wfile.flush()
   if close_socket.wait(3):
    try:self.connection.sendall(b'\x88\x00');time.sleep(.05)
    except OSError:pass
   self.close_connection=True;return
  if self.path=='/close':
   close_socket.set();self.send_response(200);self.end_headers();return
  if self.path.startswith('/report?'):
   events.append({'time':time.time(),'path':self.path});self.send_response(200);self.end_headers();self.wfile.write(b'ok');return
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
 for mode in (sys.argv[1:] or ['websocket-close']):
  events.clear();close_socket.clear()
  with tempfile.TemporaryDirectory() as profile,open(output/(mode+'.log'),'w') as log:
   command=[str(ROOT/'.local/engines/ladybird/build-upstream/bin/Ladybird'),'--headless=manual','--force-new-process','--disable-sql-database',f'http://127.0.0.1:{server.server_port}/shared-worker-removal.html?mode={mode}']
   proc=subprocess.Popen(command,stdout=log,stderr=log,cwd=output,start_new_session=True,env={**os.environ,'QT_QPA_PLATFORM':'offscreen','XDG_CONFIG_HOME':profile,'XDG_CACHE_HOME':profile,'FONTCONFIG_FILE':str(ROOT/'tests/ladybird/fonts.conf')})
   try:
    deadline=time.monotonic()+5
    while proc.poll() is None and time.monotonic()<deadline:time.sleep(.05)
    code=proc.poll()
   finally:
    if proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=3)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
   text=(output/(mode+'.log')).read_text()
   result={'mode':mode,'command':command,'exitBeforeCleanup':code,'crashReported':'WebContent process crashed' in text,'events':list(events)}
   results.append(result);print(json.dumps(result),flush=True)
 (output/'results.json').write_text(json.dumps(results,indent=2))
finally:server.shutdown();server.server_close()
