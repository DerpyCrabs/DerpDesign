#!/usr/bin/env python3
import base64,http.server,json,os,pathlib,queue,subprocess,tempfile,threading,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'tests/ladybird'),**kwargs)
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory() as directory:
 with open('/tmp/derp-ladybird-iframe-removal.log','w') as log:
  proc=subprocess.Popen([str(ROOT/'.local/engines/ladybird/build-upstream/bin/derp-ladybird')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'DERP_FRAME_DIR':directory,'FONTCONFIG_FILE':str(ROOT/'tests/ladybird/fonts.conf')})
  messages=queue.Queue();frames=[];serial=0;history=[];failures=[]
  def read():
   for line in proc.stdout:
    try:messages.put(json.loads(line))
    except ValueError:messages.put({'invalid_stdout':line})
  threading.Thread(target=read,daemon=True).start()
  def send(method,params):
   global serial
   serial+=1
   started=time.monotonic()
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
    elif reply.get('id')==serial:
     history.append(dict(method=method,params=params,seconds=round(time.monotonic()-started,3),reply=reply));pathlib.Path('/tmp/derp-ladybird-iframe-removal.json').write_text(json.dumps(history,indent=2));return reply
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
   for generation,mode in enumerate(['parent-close','focused-parent-close','child-close'],1):
    reference=dict(paneId='iframe',generation=generation)
    reply=send('session.open',dict(generation=generation,panes=[dict(id='iframe',url=f'http://127.0.0.1:{server.server_port}/iframe-removal.html',viewport=dict(width=640,height=400,deviceScaleFactor=1))]));assert 'result' in reply,reply
    ready('iframe',generation)
    def inspect(selector,framePath=[]):
     reply=send('pane.inspect',{**reference,'selector':selector,'framePath':framePath});assert 'result' in reply,reply
     return reply['result']
    def click(selector,framePath=[]):
     target=inspect(selector,framePath)['element']['bounds']
     for action in ['down','up']:
      reply=send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=target['x']+target['width']/2,y=target['y']+target['height']/2,button='left')});assert 'result' in reply,(mode,reply)
    assert inspect('#counter')['element']['text']=='0'
    assert len(inspect('#large-inspection-payload')['element']['text'])==131072
    inspect('#focus',['#child'])
    nested=inspect('#nested',['#child','#nested-frame'])['element']
    bounds=nested['bounds'];point=dict(x=bounds['x']+bounds['width']/2,y=bounds['y']+bounds['height']/2)
    picked=send('pane.inspect',{**reference,'point':point});assert 'result' in picked,picked
    element=picked['result']['element'];assert element['tagName']=='button',element
    assert len(element['framePath'])==2,element
    assert all(abs(element['bounds'][key]-bounds[key])<.1 for key in ['x','y','width','height']),(element,bounds)
    roundtrip=inspect(element['selectors'][0],element['framePath'])['element']
    assert roundtrip['text']=='Nested frame target' and roundtrip['bounds']==element['bounds'],roundtrip
    geometry=send('pane.inspect',{**reference,'point':point,'geometryOnly':True});assert 'result' in geometry,geometry
    assert geometry['result']['geometryOnly'] is True and len(geometry['result']['element']['framePath'])==2,geometry
    assert not any(key in geometry['result'] for key in ['dom','computedStyles','matchedStyles']),geometry
    partial=send('pane.inspect',{**reference,'point':point,'framePath':['#child']});assert 'result' in partial,partial
    assert partial['result']['element']['framePath'][0]=='#child' and len(partial['result']['element']['framePath'])==2,partial
    assert partial['result']['element']['bounds']==element['bounds'],partial
    assert geometry['result']['element']['bounds']==element['bounds'],geometry
    cross=inspect('#cross')['element']['bounds']
    boundary=send('pane.inspect',{**reference,'point':dict(x=cross['x']+20,y=cross['y']+15)});assert 'result' in boundary,boundary
    assert boundary['result']['element']['tagName']=='iframe' and boundary['result']['element']['framePath']==[],boundary
    inaccessible=send('pane.inspect',{**reference,'selector':'#nested','framePath':['#cross']});assert 'error' in inaccessible,inaccessible
    print('PASS nested point pick, frame selector roundtrip, geometry fastpath and cross-origin boundary',flush=True)
    time.sleep(.1)
    capture('iframe',generation,640,400)
    remaining=inspect('#remaining')['element']['bounds']
    if mode=='focused-parent-close':click('#focus',['#child'])
    if mode=='child-close':click('#remove',['#child'])
    else:click('#close')
    for action in ['down','up']:
     reply=send('pane.input',{**reference,'event':dict(type='pointer',action=action,x=remaining['x']+remaining['width']/2,y=remaining['y']+remaining['height']/2,button='left')});assert 'result' in reply,(mode,reply)
    status=send('pane.inspect',{**reference,'selector':'#status','framePath':[]})
    counter=send('pane.inspect',{**reference,'selector':'#counter','framePath':[]})
    print(mode,'post-removal:',status.get('result',{}).get('element',{}).get('text',status.get('error')), 'counter:',counter.get('result',{}).get('element',{}).get('text',counter.get('error')),flush=True)
    result=send('pane.capture',reference)
    if 'result' in result:
     png=base64.b64decode(result['result']['pngBase64'])
     assert png[:8]==b'\x89PNG\r\n\x1a\n'
     assert int.from_bytes(png[16:20],'big')==640 and int.from_bytes(png[20:24],'big')==400
     pathlib.Path(f'/tmp/derp-ladybird-iframe-after-{generation}.png').write_bytes(png)
    print(mode,'capture:', 'result' if 'result' in result else result,flush=True)
    if 'error' in status or 'error' in counter or 'error' in result:failures.append(mode)
    else:
     assert status['result']['element']['text']=='frame removed',status
     assert status['result']['frames']==[],status['result']['frames']
     assert counter['result']['element']['text']=='1',counter
     assert counter['result']['ready'] is True,counter
     print('PASS',mode,'removed iframe, sibling counter 1, ready DOM and 640x400 PNG',flush=True)
    reply=send('session.close',dict(generation=generation));assert 'result' in reply,reply
   proc.stdin.close();assert proc.wait(timeout=20)==0
   assert not failures, 'Post-removal inspection/capture failed: '+', '.join(failures)
   stderr=pathlib.Path(log.name).read_text()
   assert '\"__DERPDESIGN_INSPECTION__\"' not in stderr, 'Duplicate protocol JSON leaked to stderr'
   assert stderr.count('\"DERPDESIGN_IFRAME_ORDINARY_LOG\"')==3, 'Ordinary debug records were filtered'
   assert stderr.count('\"__DERPDESIGN_INSPECTION__ordinary\"')==3, 'Similar nonprotocol marker was filtered'
   assert len(stderr)<100000, f'Unexpected stderr growth: {len(stderr)}'
   print('PASS bounded stderr:',len(stderr),'bytes; ordinary/near-marker logs preserved, giant protocol absent',flush=True)
  finally:
   if not proc.stdin.closed:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
server.shutdown()
