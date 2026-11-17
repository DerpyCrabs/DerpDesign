import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    QtObject {
        id:workspace
        property var state: ({projects:[],demos:[],selection:{}})
        property string error:""
        property var requests:[]
        signal operationCompleted(string method,var result)
        signal operationFailed(string method,string clientRequestId)
        function call(method,params){requests=requests.concat([{method,params}])}
    }
    Main{id:app}
    TestCase {
        parent:app.contentItem;name:"InspectorDock";when:windowShown
        function item(name){function walk(o){if(o.objectName===name)return o;for(let child of o.children||[]){let found=walk(child);if(found)return found}return null}return findChild(app,name)||walk(app.contentItem)}
        function test_docked_tree_and_hover() {
            app.demos=[{id:"d",panes:[{id:"p",name:"Preview",viewport:{width:600,height:400},position:{x:0,y:0}}]}]
            app.selection={demoId:"d",generation:5}
            app.selectedPane="p"
            let canvas=item("demoCanvas"),fullWidth=canvas.width
            app.chooseTool("inspect")
            tryCompare(item("contextPanel"),"visible",true)
            verify(canvas.width<fullWidth)
            compare(canvas.width+item("contextPanel").width,fullWidth)
            let divider=item("inspectorResizeHandle"),oldDock=item("contextPanel").width
            mousePress(divider,3,100);mouseMove(divider,-47,100);mouseRelease(divider,-47,100)
            verify(item("contextPanel").width>oldDock)
            compare(canvas.width+item("contextPanel").width,fullWidth)
            app.requestInspection("p",{point:{x:10,y:10}},"select")
            let token=app.latestInspectRequest
            let result={paneId:"p",generation:5,clientRequestId:token,clientPurpose:"select",element:{framePath:["iframe:nth-of-type(1)"],tagName:"BUTTON",selectors:["html > body:nth-of-type(1) > button:nth-of-type(1)"],bounds:{x:30,y:40,width:120,height:36}},computedStyles:{color:"rgb(255, 255, 255)"},dom:{root:{nodeType:1,nodeName:"HTML",children:[{nodeType:1,nodeName:"BODY",children:[{nodeType:1,nodeName:"BUTTON",attributes:["id","save"],children:[]}]}]}}}
            workspace.operationCompleted("pane.inspect",result)
            let inspector=item("inspector"),tree=item("inspectorTree")
            tryCompare(tree,"count",3)
            inspector.toggle("html");tryCompare(tree,"count",1)
            inspector.toggle("html");tryCompare(tree,"count",3)
            let row=tree.itemAtIndex(2)
            mouseClick(row,row.width/2,row.height/2)
            compare(workspace.requests[workspace.requests.length-1].params.selector,"html > body:nth-of-type(1) > button:nth-of-type(1)")
            compare(workspace.requests[workspace.requests.length-1].params.framePath,["iframe:nth-of-type(1)"])
            tryVerify(()=>item("inspect-highlight-p")!==null)
            let highlight=item("inspect-highlight-p")
            tryCompare(highlight,"visible",true);compare(highlight.x,30);compare(highlight.y,40);compare(highlight.width,120)
            app.queueInspectHover("p",{x:60,y:60});let stale=app.latestInspectRequest
            app.queueInspectHover("p",{x:80,y:80});let current=app.latestInspectRequest
            wait(120)
            compare(workspace.requests[workspace.requests.length-1].params.point.x,80)
            workspace.operationCompleted("pane.inspect",Object.assign({},result,{clientRequestId:stale,clientPurpose:"hover"}))
            compare(app.inspectionPreviewPane,"")
            workspace.operationCompleted("pane.inspect",Object.assign({},result,{clientRequestId:current,clientPurpose:"hover",element:{bounds:{x:80,y:80,width:90,height:25}}}))
            compare(app.inspectionPreviewPane,"p");compare(highlight.x,80)
            app.zoom=1.25
            let start=highlight.mapToItem(canvas,0,0),end=highlight.mapToItem(canvas,highlight.width,highlight.height)
            fuzzyCompare(end.x-start.x,90*app.zoom,0.1)
            fuzzyCompare(end.y-start.y,25*app.zoom,0.1)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-inspector-docked.png"))
            app.cancelInspectHover();compare(app.inspectionPreviewPane,"")
            app.chooseTool("interact");tryCompare(canvas,"width",fullWidth)
        }
    }
}
