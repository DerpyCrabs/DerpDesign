#!/usr/bin/env python3
import base64,http.server,json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as directory:
 with open('/tmp/derp-ladybird-frames.log','w') as log:
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
   for generation in [1,2]:
    specs=[dict(id=name,url=f'http://127.0.0.1:{server.server_port}/interactive.html',viewport=dict(width=w,height=h,deviceScaleFactor=1)) for name,w,h in [('wide',480,320),('small',240,180)]]
    reply=send('session.open',dict(generation=generation,panes=specs));assert 'result' in reply,reply
    for spec in specs:capture(spec['id'],generation,spec['viewport']['width'],spec['viewport']['height'])
    reference=dict(paneId='wide',generation=generation)
    def inspect(selector=None,point=None):
     params={**reference}
     if selector:params['selector']=selector
     if point:params['point']=point
     result=send('pane.inspect',params);assert 'result' in result,result
     return result['result']
    # Motion over static background must not publish a stale bitmap per input.
    for _ in range(3):
     send('pane.input',{**reference,'event':dict(type='pointer',action='move',x=450,y=280)})
     time.sleep(.05)
    inspect('#counter')
    start_frames=len(frames)
    started=time.monotonic()
    for _ in range(100):
     reply=send('pane.input',{**reference,'event':dict(type='pointer',action='move',x=450,y=280)})
     assert 'result' in reply,reply
    inspect('#counter')
    count=len(frames)-start_frames
    assert count<10,('Unchanged pointer motion republished frames',count)
    print('100 unchanged moves:',round(time.monotonic()-started,3),'seconds;',count,'frames')
    before=inspect('#counter')
    assert before['element']['text']=='0' and before['element']['bounds']['width']==200,before['element']
    print('Computed display reported by upstream:',before['computedStyles']['display'])
    print('Computed width reported by upstream:',before['computedStyles']['width'])
    assert before['matchedStyles']['matchedCSSRules'] and before['dom']['root']['nodeType']==9
    for action in ['down','up']:
     result=send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=40.5,y=28.5,button='left')});assert 'result' in result,result
    assert inspect(point=dict(x=40.5,y=28.5))['element']['text']=='1'
    for action in ['down','up']:send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=40,y=68,button='left')})
    send('pane.input',{**reference,'event':dict(type='text',text='Ladybird ✓')})
    typed=inspect('#mirror')['element']['text'];assert typed=='Ladybird ✓',repr(typed)
    assert 'error' in send('pane.evaluate',{**reference,'expression':'document.body.remove()'})
    assert 'error' in send('pane.inspect',{**reference,'selector':'#missing'})
    reply=send('pane.resize',dict(paneId='wide',generation=generation,viewport=dict(width=400,height=300,deviceScaleFactor=1)));assert 'result' in reply,reply
    capture('wide',generation,400,300)
    reply=send('session.close',dict(generation=generation));assert 'result' in reply,reply
   assert set(f['paneId'] for f in frames)=={'wide','small'}
   proc.stdin.close();assert proc.wait(timeout=20)==0
   print('PASS real upstream Ladybird multi-pane BGRA, input, read-only DOM/CSS, PNG, resize, close/reopen, EOF')
  finally:
   if not proc.stdin.closed:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
server.shutdown()
