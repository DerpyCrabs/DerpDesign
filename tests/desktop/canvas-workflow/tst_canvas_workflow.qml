import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    id:testRoot
    width:1380;height:880
    Main{id:app}
    property int operationCount:0
    property var lastOperation:({})
    Connections{target:workspace;function onOperationCompleted(method,result){testRoot.operationCount++;testRoot.lastOperation={method:method,result:result}}}
    TestCase {
        parent:app.contentItem;name:"CanvasWorkflow";when:windowShown
        function visual(node,name){if(!node)return null;if(node.objectName===name)return node;for(let child of node.children||[]){let r=visual(child,name);if(r)return r}return null}
        function item(name){let r=findChild(app,name)||visual(app.contentItem,name);verify(r!==null,"Missing "+name);return r}
        function click(name){nativeInput.clickItem(item(name))}
        function call(method,params){let n=testRoot.operationCount;workspace.call(method,params);tryVerify(()=>testRoot.operationCount>n&&testRoot.lastOperation.method===method,30000,method+" "+JSON.stringify(params)+": "+workspace.error);verify(!workspace.error,workspace.error);return testRoot.lastOperation.result}
        function surface(id){return visual(item("pane-"+id),"paneInteraction")}
        function verifyAllPanesVisible() {
            for(let p of app.activeDemo.panes) {
                let pane=item("pane-"+p.id)
                verify(pane.visible,"Zoom/focus hid "+p.id)
                compare(pane.x,p.position.x)
                compare(pane.y,p.position.y)
            }
        }
        function test_review() {
            tryVerify(()=>workspace.state.selection?.demoId==="canvas-workflow",30000)
            for(let pane of app.activeDemo.panes){
                call("pane.capture",{paneId:pane.id})
                tryCompare(item("frame-status-"+pane.id),"visible",false,5000)
                let styles=call("pane.inspect",{paneId:pane.id,selector:".navigation"})
                console.log("NAVIGATION",pane.id,styles.computedStyles["background-color"])
                verify(styles.computedStyles["background-color"]!=="rgb(255, 255, 255)")
                let root=call("pane.inspect",{paneId:pane.id,selector:"html[data-theme='dark']"})
                compare(root.element.tagName,"html")
            }
            // No tool selection: hovering and opening menus must work immediately.
            for(let pane of app.activeDemo.panes.filter(p=>p.id.endsWith("narrow"))){
                click("focus-pane-"+pane.id)
                compare(app.mode,"interact")
                verifyAllPanesVisible()
                compare(Math.round(surface(pane.id).width*app.zoom*app.displayDensity),Math.round(480*app.displayDensity))
                compare(engines.frameSize(pane.id).width,Math.round(480*app.displayDensity))
                let menu=call("pane.inspect",{paneId:pane.id,selector:'[aria-label="Menu"]'}).element.bounds
                mouseMove(surface(pane.id),menu.x+menu.width/2,menu.y+menu.height/2)
                let hovered=call("pane.inspect",{paneId:pane.id,selector:'[aria-label="Menu"]:hover'})
                compare(hovered.element.tagName,"button")
                mouseMove(app.contentItem,4,4)
                let unhovered=call("pane.inspect",{paneId:pane.id,selector:'[aria-label="Menu"]:not(:hover)'})
                compare(unhovered.element.tagName,"button")
                mouseClick(surface(pane.id),menu.x+menu.width/2,menu.y+menu.height/2)
                wait(200)
                let expanded=call("pane.inspect",{paneId:pane.id,selector:'[aria-label="Menu"][aria-expanded="true"]'})
                compare(expanded.element.tagName,"button")
                call("pane.inspect",{paneId:pane.id,selector:'#menu-popup'})
                verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-menu-"+pane.engine+".png"))
                mouseClick(surface(pane.id),menu.x+menu.width/2,menu.y+menu.height/2)
                wait(200)
                click("zoom-fit-all")
            }
            // Select another pane through the actual header dropdown.
            let navigator=item("paneNavigator")
            nativeInput.clickItem(navigator)
            tryVerify(()=>navigator.popup.opened)
            keyClick(Qt.Key_Home)
            keyClick(Qt.Key_Return)
            tryCompare(navigator.popup,"opened",false)
            compare(app.selectedPane,app.activeDemo.panes[0].id)
            compare(app.zoom,app.actualScale)
            verifyAllPanesVisible()
            click("zoom-fit-all")
            wait(100)
            let canvas=item("demoCanvas")
            for(let name of ["projectPicker","demoPicker","paneNavigator"]){let picker=item(name);verify(picker.contentItem.width>=picker.contentItem.contentWidth,"Selector label clipped: "+name)}
            compare(canvas.width,app.width)
            compare(canvas.height,app.height-42)
            verify(!app.panelOpen)
            for(let p of app.activeDemo.panes){
                let pane=item("pane-"+p.id)
                for(let edge of ["left","right","top","bottom"]){
                    let border=visual(pane,"frame-"+edge)
                    verify(border.x+border.width<=0 || border.x>=pane.width || border.y+border.height<=0 || border.y>=pane.height,"Border must remain entirely outside content: "+edge)
                }
            }
            for(let p of app.activeDemo.panes){let pane=item("pane-"+p.id);let pt=pane.mapToItem(canvas,0,0);verify(pt.x>=0&&pt.y>=0,"Pane outside overview");verify(pt.x+pane.width*app.zoom<=canvas.width+1);verify(pt.y+pane.height*app.zoom<=canvas.height+1)}
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-overview.png"))
            let id="canvas-chromium-wide"
            click("focus-pane-"+id);compare(app.mode,"interact");compare(app.zoom,app.actualScale);verifyAllPanesVisible()
            compare(Math.round(surface(id).width*app.zoom*app.displayDensity),Math.round(1000*app.displayDensity))
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-actual.png"))
            click("mode-inspect");mouseClick(surface(id),150,25)
            tryVerify(()=>app.inspection.element,15000)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-inspect.png"))
            click("mode-hand")
            let before=app.panX
            let panPoint=surface(id).mapToItem(app.contentItem,300,200)
            mouseDrag(app.contentItem,panPoint.x,panPoint.y,80,0)
            verify(Math.abs(app.panX-before-80)<3,"Hand pan must track screen pixels in screen coordinates, got "+(app.panX-before))
            click("zoom-actual");compare(app.zoom,app.actualScale);verifyAllPanesVisible()
            click("zoom-fit-all");verifyAllPanesVisible()
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-reviewed-overview.png"))
            app.width=2000;app.height=1120;wait(100);click("zoom-fit-all");wait(100)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-large.png"))
            app.width=1280;app.height=800;wait(100);click("zoom-fit-all");wait(100)
            for(let name of ["mode-interact","mode-hand","mode-inspect","zoom-actual"]) {
                let control=item(name),point=control.mapToItem(app.contentItem,0,0)
                verify(point.x>=0&&point.y>=0&&point.x+control.width<=app.width&&point.y+control.height<=app.height,"Control outside window: "+name)
            }
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-canvas-compact.png"))
        }
    }
}
