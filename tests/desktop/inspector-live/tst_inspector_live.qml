import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    id:testRoot
    Main{id:app}
    property var result: ({})
    property int count:0
    Connections{target:workspace;function onOperationCompleted(method,value){if(method==="pane.inspect"){testRoot.result=value;testRoot.count++}}}
    TestCase {
        parent:app.contentItem;name:"LiveInspector";when:windowShown
        function visual(node,name){if(node.objectName===name)return node;for(let c of node.children||[]){let r=visual(c,name);if(r)return r}return null}
        function item(name){let found=findChild(app,name)||visual(app.contentItem,name);verify(found!==null,"Missing "+name);return found}
        function inspect(id,selector,framePath=[]){let before=testRoot.count;workspace.call("pane.inspect",{paneId:id,selector,framePath});tryVerify(()=>testRoot.count>before,30000);return testRoot.result}
        function test_engine_inspection() {
            tryVerify(()=>workspace.state.selection?.demoId==="inspector-live",30000)
            for(let pane of app.activeDemo.panes) {
                tryVerify(()=>engines.frameSize(pane.id).width>0,30000)
                let save=inspect(pane.id,"#save"),b=save.element.bounds
                app.focusPane(pane.id)
                app.chooseTool("inspect")
                // Fit the viewport into the reduced canvas before pointing.
                app.fitPane();wait(80)
                let surface=visual(item("pane-"+pane.id),"paneInteraction")
                mouseMove(app.contentItem,4,4);wait(20)
                mouseMove(surface,b.x+b.width/2,b.y+b.height/2)
                tryCompare(app,"inspectionPreviewPane",pane.id,30000)
                compare(app.inspectionPreview.element.tagName.toLowerCase(),"button")
                compare(app.inspectionPreview.geometryOnly,true)
                verify(app.inspectionPreview.dom===undefined)
                verify(app.inspectionPreview.computedStyles===undefined)
                verify(app.inspectionPreview.matchedStyles===undefined)
                verify(app.inspectionPreview.element.text===undefined)
                mouseClick(surface,b.x+b.width/2,b.y+b.height/2)
                tryVerify(()=>app.inspection.element?.tagName?.toLowerCase()==="button"&&app.inspection.paneId===pane.id,30000)
                verify(Object.keys(app.inspection.computedStyles).length>0)
                verify((app.inspection.matchedStyles.matchedCSSRules||[]).length>0)
                let tree=item("inspectorTree")
                tryVerify(()=>tree.count>5)
                let rows=item("inspector").rows,index=rows.findIndex(r=>r.label==="section.card")
                verify(index>=0,"Missing card DOM node")
                tree.positionViewAtIndex(index,ListView.Center);wait(30)
                let row=tree.itemAtIndex(index)
                mouseClick(row,row.width/2,row.height/2)
                tryVerify(()=>app.inspection.element?.tagName?.toLowerCase()==="section",30000)
                let highlight=item("inspect-highlight-"+pane.id)
                verify(highlight.visible)
                compare(highlight.x,app.inspection.element.bounds.x)
                compare(highlight.width,app.inspection.element.bounds.width)
                wait(100)
                verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-inspector-real-"+pane.engine+".png"))
                app.chooseTool("interact")
            }
            // Exercise nested-frame inspection.
            let id="inspect-ladybird",target=inspect(id,"#nested-save",["#nested-frame","#leaf"]),b=target.element.bounds
            app.focusPane(id);app.chooseTool("inspect");app.fitPane();wait(80)
            let surface=visual(item("pane-"+id),"paneInteraction")
            mouseMove(app.contentItem,4,4);wait(20);mouseMove(surface,b.x+b.width/2,b.y+b.height/2)
            tryVerify(()=>app.inspectionPreviewPane===id&&(app.inspectionPreview.element?.framePath||[]).length===2,30000)
            mouseClick(surface,b.x+b.width/2,b.y+b.height/2)
            tryVerify(()=>app.inspection.element?.tagName==="button"&&(app.inspection.element.framePath||[]).length===2,30000)
            let tree=item("inspectorTree"),inspector=item("inspector")
            tryVerify(()=>inspector.rows.some(row=>row.label==="section.nested-card"))
            let index=inspector.rows.findIndex(row=>row.label==="section.nested-card")
            tree.positionViewAtIndex(index,ListView.Center);wait(30)
            let row=tree.itemAtIndex(index);mouseClick(row,row.width/2,row.height/2)
            tryVerify(()=>app.inspection.element?.tagName==="section"&&(app.inspection.element.framePath||[]).length===2,30000)
            compare(app.inspection.element.bounds.x,target.element.bounds.x-16)
            wait(100)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-inspector-real-nested-ladybird.png"))
        }
    }
}
