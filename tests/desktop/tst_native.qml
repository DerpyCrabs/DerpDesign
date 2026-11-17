import QtQuick
import QtQuick.Controls
import QtTest
import "../../apps/desktop/qml"
Item {
 width: 900; height: 700
 SystemPalette { id: colors }
 QtObject {
  id: workspace
  property var calls: []
  function call(method, params) { calls.push({method:method,params:params}) }
 }
 QtObject {
  id: host
  property var palette: colors
  property string selectedPane: ""
  property string mode: "interact"
  property real zoom: 0.5
 }
 PaneView { id: pane; host: host; scale: host.zoom; transformOrigin: Item.TopLeft
  pane: ({id:"native",name:"Native",engine:"cef",position:{x:40,y:40},viewport:{width:800,height:600}})
 }
 TestCase {
  name: "NativePane"; when: windowShown
  function test_pointerAndKeys() {
   let surface = findChild(pane,"paneInteraction")
   mouseClick(surface,80,80)
   keyClick(Qt.Key_Left)
   let keys = workspace.calls.filter(c => c.params.event && c.params.event.type === "key")
   compare(keys.length,2)
   compare(keys[0].params.event.key,"ArrowLeft")
   compare(keys[1].params.event.key,"ArrowLeft")
   grabImage(pane).save("/tmp/derp-native-pane.png")
  }
 }
}
