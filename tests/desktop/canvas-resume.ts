import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {start} from '../../packages/workspace/src/main';

const root = resolve(import.meta.dir, '../..');
const base = join(root, '.local/verification');
await mkdir(base, {recursive:true});
const directory = await mkdtemp(join(base, 'canvas-resume-'));
const reservation = Bun.serve({port:0, fetch:()=>new Response()});
const port = reservation.port;
reservation.stop(true);
await writeFile(join(directory, 'index.html'), '<body style="background:#234567">Resume fixture</body>');

async function run(test:string, restoreDesktop:boolean, explicit?:string) {
    const desktopToken = crypto.randomUUID();
    const {workspace,server} = await start({directory,restoreDesktop,port:0,token:crypto.randomUUID(),desktopToken});
    workspace.hostMode = 'window';
    if (test === 'save') {
        await workspace.call('project.register',{id:'project',name:'Resume',sourceRoot:directory,supportRoot:directory,
            server:{cwd:directory,command:['python3','-m','http.server',String(port),'--bind','127.0.0.1'],url:'http://127.0.0.1:'+port}});
        for (const id of ['first','second']) await workspace.call('demo.put',{id,projectId:'project',name:id,description:'',
            panes:[{id:'pane',name:'Pane',engine:'chromium',viewport:{width:600,height:400,deviceScaleFactor:1},position:{x:0,y:0},route:'/index.html',conditions:{}}]});
    }
    const proc = Bun.spawn([join(root,'build/desktop/desktop-native-tests'),'-input',join(import.meta.dir,'canvas-resume'),'CanvasResume::test_'+test],{
        env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software',DERP_HEADLESS:'1',DERP_NATIVE_REAL:'1',
            DERP_CANVAS_SETTINGS:join(directory,'canvas.ini'),DERP_WORKSPACE_URL:'http://127.0.0.1:'+server.port,
            DERP_DESKTOP_TOKEN:desktopToken,DERP_CHROMIUM_WORKER:join(root,'.local/engines/chromium/build/derp-chromium')},
        stdout:'inherit',stderr:Bun.file(join(directory,test+'.log'))});
    try {
        if (explicit) {
            for (let i=0; !workspace.socket; i++) {assert(i<200 && proc.exitCode===null); await Bun.sleep(50);}
            assert.equal(workspace.state.selection.demoId,null);
            await workspace.call('selection.set',{projectId:'project',demoId:explicit});
        }
        if (test === 'switch') {
            for (let i=0; !await Bun.file(join(directory,'switch-ready.png')).exists(); i++) {
                assert(i<300 && proc.exitCode===null);
                await Bun.sleep(50);
            }
            // The same endpoint used by MCP requests a fresh selection, even for the same demo.
            await workspace.call('selection.set',{projectId:'project',demoId:'first'});
        }
        assert.equal(await proc.exited,0,test);
    } finally {
        proc.kill();
        await workspace.stop();
        server.stop(true);
    }
}
await run('save',false,'first');
await run('resume',true);
await run('switch',true);
await run('override',false,'second');
console.log('PASS desktop resume, explicit selection, canvas restore and switch',directory);
