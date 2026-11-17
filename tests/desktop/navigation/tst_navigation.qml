import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    QtObject {
        id: workspace
        property var state: ({projects:[{id:"p",name:"Example project"}],demos:[{id:"d",projectId:"p",name:"Example demo",panes:[]}],selection:{}})
        property string error: ""
        signal operationCompleted(string method, var result)
        function call(method, params) {}
    }
    Main { id:app }
    TestCase {
        parent:app.contentItem
        name:"NavigationVisibility";when:windowShown
        function item(name){return findChild(app,name)}
        function checkLabel(picker) {
            verify(picker.visible)
            verify(picker.contentItem.width-picker.contentItem.leftPadding-picker.contentItem.rightPadding >= picker.contentItem.contentWidth,
                   "Cropped label: "+picker.displayText)
        }
        function test_remote_focus_keeps_demo_panes() {
            app.demos=[{id:"remote",projectId:"p",panes:[{id:"a",name:"A",viewport:{width:400,height:300},position:{x:0,y:0}},{id:"b",name:"B",viewport:{width:400,height:300},position:{x:450,y:0}}]}]
            app.selection={projectId:"p",demoId:"remote",generation:8}
            app.requestedFocus={paneId:"b",generation:8,nonce:"first"}
            tryCompare(app,"selectedPane","b");compare(app.zoom,1);compare(app.activeDemo.panes.length,2);compare(app.overview,false)
            app.zoom=0.75;app.requestedFocus={paneId:"b",generation:8,nonce:"first"};wait(30);compare(app.zoom,0.75)
            app.requestedFocus={paneId:"a",generation:7,nonce:"stale"};wait(30);compare(app.selectedPane,"b")
            app.requestedFocus={paneId:"a",generation:8,nonce:"second"};tryCompare(app,"selectedPane","a");compare(app.activeDemo.panes.length,2)
            app.requestedFocus={};app.demos=workspace.state.demos;app.selection={}
        }
        function test_long_popup_labels() {
            app.projects=[{id:"p",name:"Project"},{id:"other",name:"Project with a considerably longer descriptive name"}]
            app.demos=[{id:"d",projectId:"p",name:"Demo with a considerably longer descriptive name",panes:[{id:"pane",name:"Pane with a considerably longer descriptive name",viewport:{width:400,height:300},position:{x:0,y:0}}]}]
            app.selection={projectId:"p",demoId:"d"}
            let pickers=[item("projectPicker"),item("demoPicker"),item("paneNavigator")]
            wait(50)
            for(let picker of pickers) {
                checkLabel(picker)
                compare(picker.height,30)
                picker.popup.open()
                tryCompare(picker.popup,"opened",true)
                let list=picker.popup.contentItem
                tryVerify(()=>list.count>0)
                for(let index=0;index<list.count;index++) {
                    tryVerify(()=>list.itemAtIndex(index)!==null)
                    let row=list.itemAtIndex(index)
                    compare(row.height,30)
                    verify(row.contentItem.width>=row.contentItem.contentWidth,"Cropped popup row: "+row.contentItem.text)
                }
                verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-navigation-"+picker.objectName+"-popup.png"))
                picker.popup.close()
            }
            app.projects=workspace.state.projects
            app.demos=workspace.state.demos
            app.selection={}
        }
        function test_selection_dependencies() {
            let project=item("projectPicker"),demo=item("demoPicker"),pane=item("paneNavigator")
            tryCompare(demo,"visible",false);compare(pane.visible,false)
            checkLabel(project)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-navigation-empty.png"))
            app.selection={projectId:"p"}
            tryCompare(demo,"visible",true);compare(pane.visible,false)
            wait(50);checkLabel(demo)
            app.selection={projectId:"p",demoId:"d"}
            tryCompare(pane,"visible",true)
            wait(50);checkLabel(project);checkLabel(demo);checkLabel(pane)
            compare(pane.displayText,"Focus pane")
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-navigation-selected.png"))
            app.selection={}
            tryCompare(demo,"visible",false);compare(pane.visible,false)
        }
    }
}
