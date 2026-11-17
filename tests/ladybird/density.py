#!/usr/bin/env python3
import base64,http.server,json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as directory:
 with open('/tmp/derp-ladybird-density.log','w') as log:
  proc=subprocess.Popen([str(ROOT/'.local/engines/ladybird/build-upstream/bin/derp-ladybird')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'DERP_FRAME_DIR':directory,'FONTCONFIG_FILE':str(ROOT/'tests/ladybird/fonts.conf')})
  messages=queue.Queue();frames=[];serial=0
  def read():
   for line in proc.stdout:
    try:messages.put(json.loads(line))
    except ValueError:messages.put({'invalid_stdout':line})
  threading.Thread(target=read,daemon=True).start()
  def send(method,params):
   global serial
   serial+=1
   proc.stdin.write(json.dumps(dict(id=serial,method=method,params=params,deadline=int(time.time()*1000)+30000))+'\n');proc.stdin.flush()
   deadline=time.monotonic()+35
   while time.monotonic()<deadline:
    if proc.poll() is not None:raise AssertionError(pathlib.Path(log.name).read_text())
    try:reply=messages.get(timeout=.1)
    except queue.Empty:continue
    if reply.get('event')=='frame':
     data=pathlib.Path(reply['path']).read_bytes()
     assert len(data)==reply['stride']*reply['height'];frames.append(reply)
     proc.stdin.write(json.dumps(dict(method='frame.ack',params={k:reply[k] for k in ['paneId','generation','sequence']}))+'\n');proc.stdin.flush()
    elif reply.get('id')==serial:return reply
    elif 'invalid_stdout' in reply:raise AssertionError(reply)
   raise AssertionError('Worker deadline')
  def ready(pane,generation):
   deadline=time.monotonic()+30
   while time.monotonic()<deadline:
    reply=send('pane.ready',dict(paneId=pane,generation=generation))
    if 'result' in reply:return
    assert reply['error']['code']=='not_ready',reply
    time.sleep(.05)
   raise AssertionError(pathlib.Path(log.name).read_text())
  def capture(pane,generation,width,height):
   ready(pane,generation)
   reply=send('pane.capture',dict(paneId=pane,generation=generation));assert 'result' in reply,reply
   png=base64.b64decode(reply['result']['pngBase64']);assert int.from_bytes(png[16:20],'big')==width and int.from_bytes(png[20:24],'big')==height
   pathlib.Path(f'/tmp/derp-ladybird-{pane}-{generation}.png').write_bytes(png)
  try:
   for generation in [1]:
    specs=[dict(id=name,url=f'http://127.0.0.1:{server.server_port}/density.html',viewport=dict(width=w,height=h,deviceScaleFactor=scale)) for name,w,h,scale in [('wide',480,320,1),('double',480,320,2),('fractional',480,320,1.25)]]
    reply=send('session.open',dict(generation=generation,panes=specs));assert 'result' in reply,reply
    for spec in specs:
     reference=dict(paneId=spec['id'],generation=generation)
     scale=spec['viewport']['deviceScaleFactor']
     capture(spec['id'],generation,int(480*scale),int(320*scale))
     result=send('pane.inspect',{**reference,'selector':'#metrics'})['result']
     assert json.loads(result['element']['text'])==dict(dpr=scale,width=480,height=320),result['element']
     for action in ['down','up']:send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=40.5,y=28.5,button='left')})
     assert send('pane.inspect',{**reference,'selector':'#counter'})['result']['element']['text']=='1'
     for action in ['down','up']:send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=40,y=68,button='left')})
     send('pane.input',{**reference,'event':dict(type='text',text='Density ✓')})
     assert send('pane.inspect',{**reference,'selector':'#mirror'})['result']['element']['text']=='Density ✓'
     result=send('pane.resize',{**reference,'viewport':dict(width=400,height=300,deviceScaleFactor=scale)});assert 'result' in result,result
     capture(spec['id'],generation,int(400*scale),int(300*scale))
     result=send('pane.inspect',{**reference,'selector':'#metrics'})['result']
     assert json.loads(result['element']['text'])==dict(dpr=scale,width=400,height=300),result['element']
     changed=2 if scale==1 else 1
     result=send('pane.resize',{**reference,'viewport':dict(width=360,height=240,deviceScaleFactor=changed)});assert 'result' in result,result
     capture(spec['id'],generation,int(360*changed),int(240*changed))
     result=send('pane.inspect',{**reference,'selector':'#metrics'})['result']
     assert json.loads(result['element']['text'])==dict(dpr=changed,width=360,height=240),result['element']
     result=send('pane.resize',{**reference,'viewport':dict(width=360,height=240,deviceScaleFactor=0)});assert result['error']['code']=='viewport',result
     print(spec['id'],scale,'PASS')
    reply=send('session.close',dict(generation=generation));assert 'result' in reply,reply
   assert set(f['paneId'] for f in frames)=={'wide','double','fractional'}
   proc.stdin.close();assert proc.wait(timeout=20)==0
   print('PASS upstream Ladybird simultaneous DPR 1/2/1.25, CSS viewport, physical PNG/BGRA, pointer/text, resize')
  finally:
   if not proc.stdin.closed:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
server.shutdown()
