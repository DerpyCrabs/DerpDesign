#!/usr/bin/env python3
import signal
from PIL import Image
import base64,http.server,json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as directory:
 with open('/tmp/derp-ladybird-lifecycle.log','w') as log:
  proc=subprocess.Popen([str(ROOT/'.local/engines/ladybird/build-upstream/bin/derp-ladybird')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'DERP_FRAME_DIR':directory,'FONTCONFIG_FILE':str(ROOT/'tests/ladybird/fonts.conf')})
  messages=queue.Queue();frames=[];serial=0
  def read():
   for line in proc.stdout:
    try:messages.put(json.loads(line))
    except ValueError:messages.put({'invalid_stdout':line})
  threading.Thread(target=read,daemon=True).start()
  def send(method,params,timeout=30000):
   global serial
   serial+=1
   proc.stdin.write(json.dumps(dict(id=serial,method=method,params=params,deadline=int(time.time()*1000)+timeout))+'\n');proc.stdin.flush()
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
   generation=1
   reference=dict(paneId='life',generation=generation)
   def spec(route='/lifecycle.html'):
    return dict(id='life',url=f'http://127.0.0.1:{server.server_port}'+route,viewport=dict(width=400,height=300,deviceScaleFactor=1))
   def inspect(selector='#state'):
    reply=send('pane.inspect',{**reference,'selector':selector});assert 'result' in reply,reply
    return reply['result']
   def click(y):
    for action in ['down','up']:
     reply=send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=40,y=y,button='left')});assert 'result' in reply,reply
   reply=send('session.open',dict(generation=generation,panes=[spec()]));assert 'result' in reply,reply
   assert inspect()['element']['text']=='waiting'
   started=time.monotonic()
   reply=send('pane.ready',reference,timeout=150)
   assert reply['error']['code']=='deadline',reply
   assert time.monotonic()-started<2,'Explicit short deadline was ignored'
   assert inspect()['element']['text']=='waiting'
   click(30)
   assert inspect()['element']['text']=='settled'
   capture('life',generation,400,300)
   image=Image.open('/tmp/derp-ladybird-life-1.png').convert('RGB')
   assert image.getpixel((390,290))==(32,128,64),image.getpixel((390,290))
   reply=send('pane.reset',reference);assert 'result' in reply,reply
   assert inspect()['element']['text']=='waiting'
   click(80)
   ready('life',generation)
   assert inspect()['element']['text']=='settled'
   # Validation must be transactional: reject both invalid definitions while
   # retaining the existing page and generation.
   bad=spec();bad['url']='this is not a URL'
   for panes in [[bad],[spec(),spec()]]:
    reply=send('session.open',dict(generation=2,panes=panes))
    assert reply['error']['code']=='invalid_pane',reply
    assert inspect()['element']['text']=='settled'
   reply=send('session.open',dict(generation=generation,panes=[spec('/lifecycle.html?mode=error')]));assert 'result' in reply,reply
   started=time.monotonic();reply=send('pane.ready',reference,timeout=2000)
   assert reply['error']['code'] in ['harness','inspection'] and 'Fixture failed explicitly' in reply['error']['message'],reply
   assert time.monotonic()-started<1.5,'Harness error only surfaced at timeout'
   assert inspect()['harnessError']=='Fixture failed explicitly'
   reply=send('session.open',dict(generation=generation,panes=[spec('/lifecycle.html?mode=ready')]));assert 'result' in reply,reply
   ready('life',generation)
   # Kill only this worker's own WebContent child, never unrelated engines.
   children=[]
   for path in pathlib.Path('/proc').glob('[0-9]*'):
    try:
     parent=int((path/'stat').read_text().rsplit(')',1)[1].split()[1])
     command=(path/'cmdline').read_bytes().split(b'\0')[0]
     if parent==proc.pid and pathlib.Path(os.fsdecode(command)).name=='WebContent':children.append(int(path.name))
    except (FileNotFoundError,ProcessLookupError,PermissionError):pass
   assert children,'No owned WebContent child found for crash verification'
   os.kill(children[0],signal.SIGKILL)
   time.sleep(.1)
   reply=send('pane.inspect',{**reference,'selector':'#state'},timeout=2000)
   assert reply['error']['code']=='engine_crashed',reply
   assert proc.poll() is None,'Worker died with its WebContent child'
   started=time.monotonic()
   reply=send('pane.input',{**reference,'event':dict(type='pointer',action='down',x=40,y=30,button='left')},timeout=2000)
   assert reply['error']['code']=='engine_crashed',reply
   assert time.monotonic()-started<1,'Known crashed input waited for deadline'
   reply=send('pane.resize',{**reference,'viewport':dict(width=400,height=300,deviceScaleFactor=1)},timeout=2000)
   assert reply['error']['code']=='engine_crashed',reply
   # Allow the automatic error-page navigation/paint to complete. It must not
   # turn a dead renderer into an apparently successful scenario capture.
   time.sleep(1)
   for method in ['pane.inspect','pane.capture']:
    reply=send(method,{**reference,'selector':'body'} if method=='pane.inspect' else reference,timeout=2000)
    assert reply['error']['code']=='engine_crashed',reply
   reply=send('pane.reset',reference);assert 'result' in reply,reply
   ready('life',generation)
   recovered=inspect()
   assert recovered['element']['text']=='settled',recovered
   assert recovered['harnessError'] is None,recovered
   capture('life',generation,400,300)
   image=Image.open('/tmp/derp-ladybird-life-1.png').convert('RGB')
   assert image.getpixel((390,290))==(32,128,64),image.getpixel((390,290))
   reply=send('session.close',dict(generation=generation));assert 'result' in reply,reply
   proc.stdin.close();assert proc.wait(timeout=20)==0
   print('PASS upstream Ladybird explicit deadline, read-only inspection while unready, reset/navigation recovery, fresh capture pixels, transactional validation, harness error, sticky WebContent crash reporting and original-scenario reset recovery')
  finally:
   if not proc.stdin.closed:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
server.shutdown()
