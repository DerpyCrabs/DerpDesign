import QtQuick
import QtQuick.Controls
import DerpDesign.Native 1.0

Item {
    id: paneView; objectName: "pane-" + pane.id
    required property var pane
    required property var host
    x: pane.position.x; y: pane.position.y
    property real headerHeight: 24 / host.zoom
    width: pane.viewport.width; height: pane.viewport.height + headerHeight
    function input(event) { workspace.call("pane.input", {paneId: pane.id, event: event}) }
    function buttonName(button) { return button === Qt.RightButton ? "right" : button === Qt.MiddleButton ? "middle" : "left" }
    function keyName(event) {
        let names = {}; names[Qt.Key_Return] = "Enter"; names[Qt.Key_Enter] = "Enter"; names[Qt.Key_Backspace] = "Backspace"; names[Qt.Key_Tab] = "Tab"; names[Qt.Key_Escape] = "Escape"; names[Qt.Key_Delete] = "Delete"; names[Qt.Key_Left] = "ArrowLeft"; names[Qt.Key_Right] = "ArrowRight"; names[Qt.Key_Up] = "ArrowUp"; names[Qt.Key_Down] = "ArrowDown"
        names[Qt.Key_Home] = "Home"; names[Qt.Key_End] = "End"; names[Qt.Key_PageUp] = "PageUp"; names[Qt.Key_PageDown] = "PageDown"; names[Qt.Key_Backtab] = "Tab"
        names[Qt.Key_Shift] = "Shift"; names[Qt.Key_Control] = "Control"; names[Qt.Key_Alt] = "Alt"; names[Qt.Key_Meta] = "Meta"
        return names[event.key] || (event.key >= Qt.Key_A && event.key <= Qt.Key_Z ? String.fromCharCode(event.key).toLowerCase() : event.text)
    }
    function modifiers(value) {
        let result = []
        if (value & Qt.ShiftModifier) result.push("shift")
        if (value & Qt.ControlModifier) result.push("control")
        if (value & Qt.AltModifier) result.push("alt")
        if (value & Qt.MetaModifier) result.push("meta")
        return result
    }
    Rectangle { width:parent.width;height:paneView.headerHeight;color:"#1d2531" }
    // Four strips outside the pane bounds: never paint over browser pixels.
    property real frameWidth: 2 / host.zoom
    property color frameColor: host.selectedPane===pane.id ? "#699cff" : "#3b485c"
    Rectangle {objectName:"frame-left";x:-paneView.frameWidth;y:-paneView.frameWidth;width:paneView.frameWidth;height:paneView.height+2*paneView.frameWidth;color:paneView.frameColor}
    Rectangle {objectName:"frame-right";x:paneView.width;y:-paneView.frameWidth;width:paneView.frameWidth;height:paneView.height+2*paneView.frameWidth;color:paneView.frameColor}
    Rectangle {objectName:"frame-top";x:0;y:-paneView.frameWidth;width:paneView.width;height:paneView.frameWidth;color:paneView.frameColor}
    Rectangle {objectName:"frame-bottom";x:0;y:paneView.height;width:paneView.width;height:paneView.frameWidth;color:paneView.frameColor}
    Label {x:10/host.zoom;y:(paneView.headerHeight-height)/2;text:pane.name; font.pixelSize:12/host.zoom;color:"#d2deef";width:parent.width-112/host.zoom;elide:Text.ElideRight}
    MouseArea {
        id:headerDrag;objectName:"paneHeader";x:0;y:0;width:parent.width;height:paneView.headerHeight
        cursorShape:(host.mode==="select"||host.mode==="interact")?Qt.SizeAllCursor:Qt.PointingHandCursor
        drag.target:(host.mode==="select"||host.mode==="interact")?paneView:null
        onPressed:host.selectedPane=pane.id
        onDoubleClicked:host.focusPane(pane.id)
        onReleased:{if((host.mode==="select"||host.mode==="interact"))workspace.call("pane.move",{paneId:pane.id,position:{x:paneView.x,y:paneView.y}})}
    }
    ActionButton { objectName:"focus-pane-"+pane.id;x:parent.width-width-6/host.zoom;y:(paneView.headerHeight-height)/2;width:80/host.zoom;height:20/host.zoom;scale:1; font.pixelSize:11/host.zoom;padding:2/host.zoom;text:"100% ↗";hint:"Center canvas on this pane at 100%";onClicked:host.focusPane(pane.id) }
    Item {
        id: viewport
        x: 0; y: paneView.headerHeight; width: parent.width; height: pane.viewport.height
        clip: false
        Rectangle { anchors.fill: parent; color: "#141414" }
        EngineSurface { anchors.fill: parent; paneId: pane.id; manager: engines }
        Label {
            id:frameStatus;objectName:"frame-status-"+pane.id;anchors.centerIn:parent
            text:engines.paneError(pane.id);visible:text.length>0;color:"#e4a0a0"
            function refresh(){text=engines.paneError(pane.id)}
            Connections {target:engines
                function onFrameChanged(id){if(id===pane.id)frameStatus.refresh()}
                function onSessionChanged(){frameStatus.refresh()}
                function onEngineError(){frameStatus.refresh()}
            }
        }
        Item {
            anchors.fill:parent;clip:true
            Rectangle {
                objectName:"inspect-highlight-"+pane.id
                property var bounds: host.inspectionPreviewPane===pane.id ? (host.inspectionPreview.element||{}).bounds : host.selectedPane===pane.id ? (host.inspection.element||{}).bounds : null
                visible:host.mode==="inspect" && !!bounds
                x:bounds?bounds.x:0;y:bounds?bounds.y:0;width:bounds?bounds.width:0;height:bounds?bounds.height:0
                color:"#306899ff";border.color:"#83b3ff";border.width:1/host.zoom
            }
        }
        MouseArea {
            id: interaction
            objectName: "paneInteraction"
            anchors.fill: parent; hoverEnabled: host.mode === "interact" || host.mode === "inspect"; acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
            cursorShape: host.mode==="hand" ? (pressed?Qt.ClosedHandCursor:Qt.OpenHandCursor) : host.mode==="inspect" ? Qt.CrossCursor : Qt.ArrowCursor
            property bool browserHovered: false
            function leaveBrowser() {
                if (!browserHovered) return
                browserHovered = false
                paneView.input({type:"pointer",action:"leave",x:-1,y:-1})
            }
            onHoverEnabledChanged: { if (!hoverEnabled) leaveBrowser() }
            Connections {
                target: host
                function onModeChanged() { if (host.mode !== "interact") interaction.leaveBrowser() }
                function onActiveChanged() { if (!host.active) interaction.leaveBrowser() }
            }
            property bool panning: false
            property point panStart
            onPressed: mouse => {
                host.selectedPane = pane.id
                forceActiveFocus()
                if(host.mode==="hand" || mouse.button===Qt.MiddleButton){panning=true;panStart=mapToItem(null,mouse.x,mouse.y);host.overview=false;return}
                if (host.mode === "interact") { browserHovered = true; paneView.input({type: "pointer", action: "down", x: mouse.x, y: mouse.y, button: paneView.buttonName(mouse.button)}) }
                else if (host.mode === "inspect") host.requestInspection(pane.id,{point:{x:mouse.x,y:mouse.y}},"select")
            }
            onPositionChanged: mouse => {
                if(panning){let p=mapToItem(null,mouse.x,mouse.y);host.panX+=p.x-panStart.x;host.panY+=p.y-panStart.y;panStart=p;return}
                if (host.mode === "interact" && (containsMouse || pressed)) {
                    browserHovered = true
                    paneView.input({type: "pointer", action: "move", x: mouse.x, y: mouse.y})
                }
                if(host.mode==="inspect")host.queueInspectHover(pane.id,{x:mouse.x,y:mouse.y})
            }
            onReleased: mouse => {
                if(panning){panning=false;return}
                if (host.mode === "interact") paneView.input({type: "pointer", action: "up", x: mouse.x, y: mouse.y, button: paneView.buttonName(mouse.button)})
            }
            onExited: {if(host.mode==="inspect")host.cancelInspectHover();leaveBrowser()}
            onCanceled: { leaveBrowser(); panning=false }
            onWheel: wheel => {
                if (host.mode === "interact" && !(wheel.modifiers & Qt.ControlModifier)) paneView.input({type:"wheel",x:wheel.x,y:wheel.y,deltaX:wheel.angleDelta.x,deltaY:wheel.angleDelta.y})
                else host.canvasWheel(wheel)
            }
            Keys.onPressed: event => {
                if (host.mode !== "interact") return

                if (event.text && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) && (event.key >= Qt.Key_Space && event.key <= Qt.Key_ydiaeresis)) paneView.input({type:"text",text:event.text})
                else paneView.input({type:"key",action:"down",key:paneView.keyName(event),modifiers:paneView.modifiers(event.modifiers)})
                event.accepted = true
            }
            Keys.onReleased: event => {
                if (host.mode !== "interact") return
                // Key-up is forwarded for modifier/shortcut handling; printable insertion happens on press.
                paneView.input({type:"key",action:"up",key:paneView.keyName(event),modifiers:paneView.modifiers(event.modifiers)})
                event.accepted = true
            }
        }

    }
}
