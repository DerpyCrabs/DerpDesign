#!/usr/bin/env python3
import base64,http.server,json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as directory:
 with open('/tmp/derp-ladybird-select.log','w') as log:
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
   pathlib.Path(f'/tmp/derp-ladybird-select-{pane}.png').write_bytes(png)
  try:
   specs=[dict(id=name,url=f'http://127.0.0.1:{server.server_port}/select.html',viewport=dict(width=400,height=300,deviceScaleFactor=scale)) for name,scale in [('one',1),('two',2),('fraction',1.25)]]
   assert 'result' in send('session.open',dict(generation=1,panes=specs))
   for spec in specs:
    reference=dict(paneId=spec['id'],generation=1)
    def inspect(selector='#choice'):
     r=send('pane.inspect',{**reference,'selector':selector});assert 'result' in r,r
     return r['result']
    def event(e):
     r=send('pane.input',{**reference,'event':e});assert 'result' in r,r
    def click(x,y):
     for action in ['down','up']:event(dict(type='pointer',action=action,x=x,y=y,button='left'))
    def key(key):
     for action in ['down','up']:event(dict(type='key',action=action,key=key))
    ready(spec['id'],1)
    click(40,28)
    inspection=inspect();popup=inspection['selectPopup'];assert popup['visible'],popup
    assert popup['bounds']['width']>=inspection['element']['bounds']['width'],popup
    assert [r['label'].strip() for r in popup['items']]==['First option','Unavailable','Available group','Second option','Third option','','Last option'],popup
    assert popup['items'][1]['disabled'] and popup['items'][2]['group']
    capture(spec['id'],1,round(400*spec['viewport']['deviceScaleFactor']),round(300*spec['viewport']['deviceScaleFactor']))
    x=popup['bounds']['x']+45;y=popup['bounds']['y']+1
    click(x,y+1.5*popup['rowHeight'])
    assert inspect()['selectPopup']['visible']
    assert inspect('#value')['element']['text']=='first'
    click(x,y+3.5*popup['rowHeight'])
    assert not inspect()['selectPopup']['visible']
    assert inspect('#value')['element']['text']=='second'
    click(40,28);key('ArrowDown');key('Enter')
    assert inspect('#value')['element']['text']=='third'
    click(40,28);key('Home');key('Escape')
    assert not inspect()['selectPopup']['visible'] and inspect('#value')['element']['text']=='third'
    click(40,28);click(380,280)
    assert not inspect()['selectPopup']['visible'] and inspect('#value')['element']['text']=='third'
    click(40,28);event(dict(type='text',text='Last'));key('Enter')
    assert inspect('#value')['element']['text']=='last'
    bounds=inspect('#long')['element']['bounds'];click(bounds['x']+30,bounds['y']+10)
    key('End');popup=inspect()['selectPopup'];assert popup['visible'] and popup['scrollOffset']>0
    key('Enter');assert inspect('#value')['element']['text']=='39'
    click(bounds['x']+30,bounds['y']+10)
    event(dict(type='wheel',x=50,y=100,deltaX=0,deltaY=120));assert inspect()['selectPopup']['scrollOffset']<popup['scrollOffset']
    key('Escape')
    click(40,28)
    assert 'result' in send('pane.resize',{**reference,'viewport':dict(width=420,height=320,deviceScaleFactor=spec['viewport']['deviceScaleFactor'])})
    assert not inspect()['selectPopup']['visible']
    print(spec['id'],'PASS popup composition, options, disabled/grouped rows, mouse, keyboard, scroll, dismissal, resize')
   assert 'result' in send('session.close',dict(generation=1))
   proc.stdin.close();assert proc.wait(timeout=20)==0
  finally:
   if not proc.stdin.closed:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
server.shutdown()
