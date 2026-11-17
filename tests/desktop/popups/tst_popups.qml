import QtQuick
import QtQuick.Controls
import QtTest
import "../../../apps/desktop/qml"
Item {
    width:1380; height:880
    Main {id:app}
    property int inspections:0
    Connections {target:workspace;function onOperationCompleted(method,result){if(method==="pane.inspect")inspections++}}
    TestCase {
        parent:app.contentItem; name:"NativeSelectPopup"; when:windowShown
        function visual(node,name) {
            if(!node)return null
            if(node.objectName===name)return node
            for(let child of node.children||[]){let found=visual(child,name);if(found)return found}
            return null
        }
        function item(name){let found=findChild(app,name)||visual(app.contentItem,name);verify(found!==null,"Missing "+name);return found}
        function inspect(selector) {
            let previous=inspections
            workspace.call("pane.inspect",{paneId:"popup-pane",selector:selector})
            tryVerify(()=>inspections>previous,15000)
            verify(!workspace.error,workspace.error)
            return workspace.inspection
        }
        function test_popup() {
            tryVerify(()=>workspace.state.selection?.demoId==="popup-demo",30000)
            workspace.call("pane.capture",{paneId:"popup-pane"})
            tryVerify(()=>(workspace.state.captures||[]).length>0,30000)
            nativeInput.clickItem(item("mode-interact"));compare(app.mode,"interact")
            let surface=item("paneInteraction")
            mouseClick(surface,40,28)
            let menu=inspect("#choice").selectPopup
            verify(menu.visible)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-native-select-open.png"))
            workspace.call("pane.capture",{paneId:"popup-pane"})
            tryVerify(()=>(workspace.state.captures||[]).length===2,15000)
            let x=menu.bounds.x+40, y=menu.bounds.y+1+3.5*menu.rowHeight
            mouseClick(surface,x,y)
            tryVerify(()=>inspect("#value").element.text==="second",15000)
            mouseClick(surface,40,28)
            verify(inspect("#choice").selectPopup.visible)
            nativeInput.keyItem(surface,Qt.Key_Home)
            nativeInput.keyItem(surface,Qt.Key_Down)
            nativeInput.keyItem(surface,Qt.Key_Down)
            nativeInput.keyItem(surface,Qt.Key_Return)
            tryVerify(()=>inspect("#value").element.text==="third",15000)
            mouseClick(surface,40,28)
            verify(inspect("#choice").selectPopup.visible)
            nativeInput.keyItem(surface,Qt.Key_Escape)
            verify(!inspect("#choice").selectPopup.visible)
            compare(inspect("#value").element.text,"third")
            mouseClick(surface,40,28)
            verify(inspect("#choice").selectPopup.visible)
            nativeInput.clickItem(item("mode-interact"))
            verify(!inspect("#choice").selectPopup.visible)
            nativeInput.clickItem(item("mode-interact"))
            mouseClick(surface,40,28)
            verify(inspect("#choice").selectPopup.visible)
            mouseClick(item("canvasBackground"),700,500)
            verify(!inspect("#choice").selectPopup.visible)
            verify(nativeInput.saveWindow(app.contentItem,"/tmp/derp-native-select-closed.png"))
        }
    }
}
