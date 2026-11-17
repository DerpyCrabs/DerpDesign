import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    id:testRoot
    Main{id:app}
    property var result: ({})
    property int count:0
    property var metrics: ({})
    property int samples:0
    Connections{target:workspace;function onOperationCompleted(method,value){if(method==="performance.snapshot"){testRoot.metrics=value;testRoot.samples++}if(method==="pane.inspect"){testRoot.result=value;testRoot.count++}}}
    TestCase {
        parent:app.contentItem;name:"PointerOwnership";when:windowShown
        function visual(node,name){if(node.objectName===name)return node;for(let c of node.children||[]){let r=visual(c,name);if(r)return r}return null}
        function item(name){let found=findChild(app,name)||visual(app.contentItem,name);verify(found!==null,"Missing "+name);return found}
        function inspect(id,selector,framePath=[]){let before=testRoot.count;workspace.call("pane.inspect",{paneId:id,selector,framePath});tryVerify(()=>testRoot.count>before,30000);return testRoot.result}
        function snapshot(){let before=testRoot.samples;workspace.call("performance.snapshot",{});tryVerify(()=>testRoot.samples>before,30000);return testRoot.metrics}
        function test_hover_ownership() {
            tryVerify(()=>workspace.state.selection?.demoId==="hover-live",30000)
            for(let pane of app.activeDemo.panes) {
                tryVerify(()=>engines.frameSize(pane.id).width>0,30000)
                app.focusPane(pane.id); app.chooseTool("interact");app.fitPane();wait(100)
                app.selectedPane = app.activeDemo.panes.find(p=>p.id!==pane.id).id
                let surface=visual(item("pane-"+pane.id),"paneInteraction")
                mouseMove(app.contentItem,4,4);wait(50)
                mouseMove(surface,100,80);wait(100)
                compare(inspect(pane.id,"#save").computedStyles["background-color"],"rgb(200, 80, 40)")
                verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-hover-"+pane.engine+".png"))
                mouseMove(app.contentItem,4,4);wait(100)
                compare(inspect(pane.id,"#save").computedStyles["background-color"],"rgb(20, 40, 60)")
                mouseMove(surface,100,80);wait(100)
                compare(inspect(pane.id,"#save").computedStyles["background-color"],"rgb(200, 80, 40)")
                // Synchronous calls cannot yield to HTTP completions: deterministic collapse.
                for(let i=0;i<100;i++)workspace.call("pane.input",{paneId:pane.id,event:{type:"pointer",action:"move",x:100+i%20,y:80}})
                let metrics
                tryVerify(()=>{metrics=snapshot().panes[pane.id];return metrics.nativeInputPending===0},30000)
                verify(metrics.nativeInputCoalesced>=98)
                compare(metrics.nativeInputReceived,metrics.nativeInputSent+metrics.nativeInputCoalesced)
                for(let field of ["nativeQueueWaitMs","engineRequestMs","frameReadCopyMs"]){verify(Number.isFinite(metrics[field]));verify(metrics[field]>=0)}
                console.log(pane.engine+" metrics "+JSON.stringify(metrics))
                // Burst motion must not delay/drop the following click or leave.
                for(let i=0;i<100;i++) mouseMove(surface,100+i%20,80,0)
                mouseClick(surface,100,80)
                mouseMove(app.contentItem,4,4)
                wait(200)
                compare(inspect(pane.id,"#save").element.text,"Clicked")
                compare(inspect(pane.id,"#save").computedStyles["background-color"],"rgb(20, 40, 60)")
                mouseMove(surface,100,80);wait(100)
                app.chooseTool("hand");wait(100)
                compare(inspect(pane.id,"#save").computedStyles["background-color"],"rgb(20, 40, 60)")
            }
            // Repeat disposal/recreation to catch intermittent worker startup failures.
            for(let cycle=0;cycle<3;cycle++){
            // Closing a hovered demo must cancel input from its outgoing QML items.
            app.chooseTool("interact")
            let id=app.activeDemo.panes[0].id
            app.focusPane(id);app.fitPane();wait(100)
            let surface=visual(item("pane-"+id),"paneInteraction")
            mouseMove(surface,100,80);wait(100)
            workspace.call("selection.set",{projectId:null,demoId:null})
            for(let i=0;i<30;i++)mouseMove(surface,100+i,80,0)
            tryVerify(()=>!workspace.state.selection.demoId,30000)
            workspace.call("pane.input",{paneId:id,event:{type:"pointer",action:"leave",x:-1,y:-1}})
            wait(150);compare(workspace.error,"")
            compare(Object.keys(snapshot().panes).length,0)
            workspace.call("selection.set",{projectId:"inspector",demoId:"hover-live"})
            tryVerify(()=>workspace.state.selection.demoId==="hover-live",30000,"Reopen failed: "+workspace.error)
            tryVerify(()=>engines.frameSize(id).width>0,30000)
            wait(150);compare(workspace.error,"")
            app.focusPane(id);app.fitPane();wait(100)
            surface=visual(item("pane-"+id),"paneInteraction")
            mouseMove(app.contentItem,4,4);mouseMove(surface,100,80);wait(100)
            compare(inspect(id,"#save").computedStyles["background-color"],"rgb(200, 80, 40)")
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-input-reopened.png"))
            }
        }
    }
}
