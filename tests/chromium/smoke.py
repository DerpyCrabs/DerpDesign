#!/usr/bin/env python3
import base64,json,os,pathlib,queue,subprocess,tempfile,threading,time,http.server
import io
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a): pass
os.chdir(ROOT/'tests/chromium')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as tmp:
 log=open('/tmp/derp-chromium-smoke.log','w')
 proc=subprocess.Popen([str(ROOT/'.local/engines/chromium/build/derp-chromium')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'DERP_FRAME_DIR':tmp})
 try:
  messages=queue.Queue()
  def read():
   for line in proc.stdout: messages.put(json.loads(line))
  threading.Thread(target=read,daemon=True).start()
  frames=[]; serial=0; surfaces={}
  def send(method,params):
   global serial
   serial+=1; ident=serial
   proc.stdin.write(json.dumps(dict(id=ident,method=method,params=params))+'\n');proc.stdin.flush()
   end=time.monotonic()+20
   while time.monotonic()<end:
    try: m=messages.get(timeout=.2)
    except queue.Empty:
     assert proc.poll() is None, pathlib.Path(log.name).read_text()
     continue
    if m.get('event')=='frame':
     data=pathlib.Path(m['path']).read_bytes()
     patch=m.get('patch')
     if patch:
      assert m['paneId']=='p'
      assert surfaces['p'].size==(m['width'],m['height'])
     width,height=(patch['width'],patch['height']) if patch else (m['width'],m['height'])
     assert len(data)==m['stride']*height
     pixels=Image.frombytes('RGBA',(width,height),data,'raw','BGRA',m['stride'])
     if patch: surfaces['p'].paste(pixels,(patch['x'],patch['y']))
     else: surfaces[m['paneId']]=pixels
     frames.append((m,data))
     proc.stdin.write(json.dumps(dict(method='frame.ack',params=dict(paneId=m['paneId'],generation=m['generation'],sequence=m['sequence'],acceptPatches=m['paneId']=='p')))+'\n');proc.stdin.flush()
    elif m.get('id')==ident:
     return m
   raise AssertionError('reply timeout')
  p=dict(paneId='p',generation=1)
  specs=[dict(id='p',url=f'http://127.0.0.1:{server.server_port}/fixture.html',viewport=dict(width=800,height=600,deviceScaleFactor=float(os.environ.get("TEST_INITIAL_DPR","1"))))]
  specs += [dict(id=name,url=f'http://127.0.0.1:{server.server_port}/fixture.html',viewport=dict(width=300,height=200,deviceScaleFactor=scale)) for name,scale in [('dense',2),('normal',1)]]
  assert 'result' in send('session.open',dict(generation=1,panes=specs))
  def capture():
   r=send('pane.capture',p)
   assert 'result' in r,r
   return base64.b64decode(r['result']['pngBase64'])
  def metrics():
   return json.loads(send('pane.inspect',{**p,'selector':'#metrics'})['result']['element']['text'])
  before=capture()
  time.sleep(.2);send('engine.status',{})
  offset=len(frames)
  for _ in range(10):
   assert send('pane.inspect',{**p,'selector':'button','geometryOnly':True})['result']['geometryOnly']
  time.sleep(.1);send('engine.status',{})
  assert sum(msg['paneId']=='p' for msg,_ in frames[offset:]) <= 1,'Read-only inspection forced repaints'
  inspected=send('pane.inspect',{**p,'selector':'button'})['result']
  assert inspected['element']['tagName']=='button'
  assert inspected['element']['text']=='0'
  assert inspected['element']['matchCount']==1
  assert inspected['element']['bounds']['width']==200
  assert inspected['computedStyles']['display']=='block'
  assert inspected['matchedStyles']['matchedCSSRules']
  assert inspected['dom']['root']['nodeName']=='#document'
  assert 'error' in send('pane.evaluate',{**p,'expression':'document.body.remove()'})
  assert 'error' in send('pane.inspect',{**p,'selector':'#missing'})
  assert 'result' in send('pane.inspect',{**p,'point':dict(x=40,y=28)})

  def click(x,y):
   for action in ['down','up']:assert 'result' in send('pane.input',{**p,'event':dict(type='pointer',action=action,x=x,y=y,button='left')})
  click(40,28);time.sleep(.3)
  send('engine.status',{})
  assert any(m.get('patch') for m,_ in frames),'Expected a cropped update'
  reconstructed=surfaces['p'].copy()
  after=capture()
  assert reconstructed.tobytes()==Image.open(io.BytesIO(after)).convert('RGBA').tobytes(),'Cropped frames differ from complete paint'
  assert after!=before,'counter did not render change'
  click(40,80)
  send('pane.input',{**p,'event':dict(type='text',text='hello CEF')})
  time.sleep(.3);typed=capture();assert typed!=after,'text did not render'
  send('pane.resize',{**p,'viewport':dict(width=400,height=300)})
  time.sleep(.3);resized=capture()
  assert int.from_bytes(resized[16:20],'big')==400 and int.from_bytes(resized[20:24],'big')==300
  for _ in range(20):
   send('engine.status',{})
   if any(m['width']==400 for m,d in frames):break
   time.sleep(.05)
  assert frames and any(m['width']==400 for m,d in frames)
  pathlib.Path('/tmp/derp-chromium-smoke.png').write_bytes(resized)
  # A high-density pane keeps CSS geometry/input while producing physical pixels.
  send('pane.resize',{**p,'viewport':dict(width=402,height=302,deviceScaleFactor=2)})
  dense=capture()
  assert int.from_bytes(dense[16:20],'big')==804 and int.from_bytes(dense[20:24],'big')==604
  assert send('pane.inspect',{**p,'selector':'button'})['result']['element']['bounds']['width']==200
  observed=metrics()
  assert observed['width']==402 and observed['height']==302 and observed['dpr']==2 and observed['dense'],observed
  click(40.5,28.5)
  time.sleep(.2)
  assert send('pane.inspect',{**p,'point':dict(x=40.5,y=28.5)})['result']['element']['text']=='2'
  pathlib.Path('/tmp/derp-chromium-dpr2.png').write_bytes(capture())
  send('pane.resize',{**p,'viewport':dict(width=400,height=300,deviceScaleFactor=1.25)})
  fractional=capture()
  assert int.from_bytes(fractional[16:20],'big')==500 and int.from_bytes(fractional[20:24],'big')==375
  observed=metrics()
  assert observed['width']==400 and observed['height']==300 and observed['dpr']==1.25 and not observed['dense'],observed
  box=send('pane.inspect',{**p,'selector':'#choice'})['result']['element']['bounds']
  click(box['x']+box['width']/2,box['y']+box['height']/2)
  time.sleep(.25)
  opened=capture()
  pathlib.Path('/tmp/derp-chromium-popup.png').write_bytes(opened)
  for key in ['ArrowDown','Enter']:
   for action in ['down','up']: send('pane.input',{**p,'event':dict(type='key',key=key,action=action)})
  time.sleep(.25)
  assert metrics()['choice']=='Second option',metrics()
  closed=capture()
  assert closed!=opened,'dropdown did not update composed capture'
  pathlib.Path('/tmp/derp-chromium-popup-closed.png').write_bytes(closed)
  for name,scale in [('dense',2),('normal',1)]:
   reference=dict(paneId=name,generation=1)
   result=send('pane.capture',reference)
   assert 'result' in result,result
   png=base64.b64decode(result['result']['pngBase64'])
   assert int.from_bytes(png[16:20],'big')==300*scale and int.from_bytes(png[20:24],'big')==200*scale
   observed=json.loads(send('pane.inspect',{**reference,'selector':'#metrics'})['result']['element']['text'])
   assert observed['width']==300 and observed['height']==200 and observed['dpr']==scale,observed
  assert metrics()['dpr']==1.25,'other pane changed zoom'
  send('session.close',dict(generation=1));proc.stdin.close();assert proc.wait(timeout=15)==0
  log.flush()
  assert 'stack smashing' not in pathlib.Path(log.name).read_text()
  print('PASS: live BGRA, rendered counter click, text entry, resize PNG, mixed DPR 1/2/1.25 with CSS input/inspection, popup composition/selection, clean shutdown')
 finally:
  if not proc.stdin.closed: proc.stdin.close()
  try: proc.wait(timeout=15)
  except subprocess.TimeoutExpired:
   proc.kill();proc.wait()
  server.shutdown()
