import QtQuick
import QtQuick.Controls
import QtQuick.Window
import QtQuick.Layouts
import DerpDesign.Native 1.0

ApplicationWindow {
    id: root; objectName: "derpdesignWindow"
    width: 1380; height: 880; visible: true
    title: "DerpDesign"
    color: "#131923"
    font.family: "Inter"
    font.pixelSize: 14
    palette.window: "#1c222d"
    palette.base: "#171e29"
    palette.text: "#dce5f2"
    palette.windowText: "#dce5f2"
    palette.button: "#283343"
    palette.buttonText: "#dce5f2"
    palette.highlight: "#6899ff"
    palette.highlightedText: "#ffffff"
    palette.mid: "#38475c"
    palette.placeholderText: "#8393aa"
    property var projects: workspace.state.projects || []
    property var demos: workspace.state.demos || []
    property var selection: workspace.state.selection || ({})
    property var activeDemo: demos.find(d => d.id === selection.demoId) || ({panes: []})
    property string handledFocusNonce: ""
    property var requestedFocus: workspace.state.focusRequest || ({})
    onRequestedFocusChanged: focusRequestTimer.restart()
    Timer {id:focusRequestTimer;interval:0;onTriggered:{let f=root.requestedFocus;if(f.nonce&&f.nonce!==root.handledFocusNonce&&f.generation===root.selection.generation&&(!f.paneId||root.activeDemo.panes.some(p=>p.id===f.paneId))){root.handledFocusNonce=f.nonce;root.raise();root.requestActivate();if(f.paneId){fitTimer.stop();root.focusPane(f.paneId)}}}}
    property string selectedPane: ""
    property var inspection: ({})
    property var inspectionPreview: ({})
    property string inspectionPreviewPane: ""
    property int inspectSerial: 0
    property string latestInspectRequest: ""
    property string selectedInspectRequest: ""
    property var pendingHover: null
    property string hoverInFlight: ""
    property real inspectorWidth: 380
    property bool inspectorOpen: panelOpen && panelTab===1
    function cancelInspectHover(){pendingHover=null;hoverInspectTimer.stop();inspectionPreview=({});inspectionPreviewPane="";latestInspectRequest=String(++inspectSerial);selectedInspectRequest=""}
    function queueInspectHover(paneId,point){
        latestInspectRequest=String(++inspectSerial)
        pendingHover={paneId,point,token:latestInspectRequest}
        if(!hoverInspectTimer.running && !hoverInFlight)hoverInspectTimer.start()
    }
    function requestInspection(paneId,target,purpose){
        if(purpose!=="hover"){pendingHover=null;hoverInspectTimer.stop();latestInspectRequest=String(++inspectSerial);selectedInspectRequest=latestInspectRequest}
        let params=Object.assign({paneId,clientRequestId:latestInspectRequest,clientPurpose:purpose},target)
        if(purpose==="hover")hoverInFlight=latestInspectRequest
        workspace.call("pane.inspect",params)
    }
    Timer{id:hoverInspectTimer;interval:90;onTriggered:{if(root.hoverInFlight)return;let request=root.pendingHover;root.pendingHover=null;if(request&&root.mode==="inspect")root.requestInspection(request.paneId,{point:request.point},"hover")}}
    property string selectionContext: [selection.projectId, selection.demoId, selection.generation].join(":")
    property string canvasContext: ""
    function saveCanvas() {
        if (!selection.demoId || canvasContext !== selectionContext || !workspace.saveCanvas) return
        workspace.saveCanvas({projectId:selection.projectId, demoId:selection.demoId,
            generation:selection.generation, panX, panY, zoom, overview})
    }
    Timer { id:saveViewTimer; interval:200; onTriggered:root.saveCanvas() }
    onPanXChanged: saveViewTimer.restart()
    onPanYChanged: saveViewTimer.restart()
    onZoomChanged: saveViewTimer.restart()
    onOverviewChanged: saveViewTimer.restart()
    onClosing: saveCanvas()
    onSelectionContextChanged: {
        saveViewTimer.stop()
        selectedPane = ""
        clearInspectionContext()
        canvasContext = selectionContext
        const view = selection.resumedFrom !== undefined && workspace.savedCanvas ? workspace.savedCanvas() : null
        if (view && view.projectId === selection.projectId && view.demoId === selection.demoId &&
            view.generation === selection.resumedFrom && Number.isFinite(view.panX) &&
            Number.isFinite(view.panY) && Number.isFinite(view.zoom) && view.zoom > 0) {
            fitTimer.stop()
            overview = view.overview
            zoom = view.zoom
            panX = view.panX
            panY = view.panY
            saveCanvas()
        } else {
            overview = true
            fitTimer.restart()
            saveViewTimer.restart()
        }
    }
    onSelectedPaneChanged: { clearInspectionContext(); engines.dismissSelectPopups(selectedPane) }
    onModeChanged: { if(mode !== "interact") engines.dismissSelectPopups() }
    onActiveChanged: { if(!active) engines.dismissSelectPopups() }
    function clearInspectionContext() {
        inspection = ({});cancelInspectHover()
    }
    property string mode: "interact"
    property real displayDensity: Screen.devicePixelRatio
    property real actualScale: 1
    property bool panelOpen: false
    property int panelTab: 0
    property bool overview: true
    property string selectedPaneName: (activeDemo.panes.find(p=>p.id===selectedPane)||{}).name||""
    function chooseTool(next) { cancelInspectHover();mode=next;panelOpen=next==="inspect";if(panelOpen)panelTab=1 }
    function centerPane(id,scale) {let p=activeDemo.panes.find(p=>p.id===id);if(!p)return;overview=false;zoom=scale;panX=(canvasArea.width-p.viewport.width*zoom)/2-p.position.x*zoom;panY=Math.max(4,(canvasArea.height-p.viewport.height*zoom-24)/2)-p.position.y*zoom}
    function actualSize(){let id=selectedPane||activeDemo.panes[0]?.id;if(id){selectedPane=id;centerPane(id,actualScale)}else zoomAround(1)}
    function fitPane(){let p=activeDemo.panes.find(p=>p.id===selectedPane);if(p)centerPane(p.id,Math.min(1,(canvasArea.width-72)/p.viewport.width,(canvasArea.height-96)/p.viewport.height))}
    function focusPane(id){selectedPane=id;chooseTool("interact");actualSize()}
    function fitAll(){overview=true;if(!activeDemo.panes.length)return;let x=Math.min(...activeDemo.panes.map(p=>p.position.x)),y=Math.min(...activeDemo.panes.map(p=>p.position.y));let right=Math.max(...activeDemo.panes.map(p=>p.position.x+p.viewport.width)),bottom=Math.max(...activeDemo.panes.map(p=>p.position.y+p.viewport.height));zoom=Math.max(.05,Math.min(1,(canvasArea.width-80)/(right-x),(canvasArea.height-100)/(bottom-y)));panX=(canvasArea.width-(right-x)*zoom)/2-x*zoom;panY=(canvasArea.height-(bottom-y)*zoom-28)/2-y*zoom}
    function zoomAround(value){let next=Math.max(.05,Math.min(4,value));let x=canvasArea.width/2,y=canvasArea.height/2;panX=x-(x-panX)*next/zoom;panY=y-(y-panY)*next/zoom;zoom=next;overview=false}
    function canvasWheel(wheel){if(wheel.modifiers&Qt.ControlModifier)zoomAround(zoom*(wheel.angleDelta.y>0?1.1:1/1.1));else{overview=false;panX+=wheel.angleDelta.x;panY+=wheel.angleDelta.y}}
    Timer{id:fitTimer;interval:30;onTriggered:root.fitAll()}
    property bool toolShortcuts: (!activeFocusItem || (activeFocusItem.objectName!=="paneInteraction" && activeFocusItem.cursorPosition===undefined))
    Shortcut{sequence:"V";enabled:root.toolShortcuts;onActivated:root.chooseTool("interact")}
    Shortcut{sequence:"H";enabled:root.toolShortcuts;onActivated:root.chooseTool("hand")}
    Shortcut{sequence:"P";enabled:root.toolShortcuts;onActivated:root.chooseTool("interact")}
    Shortcut{sequence:"I";enabled:root.toolShortcuts;onActivated:root.chooseTool("inspect")}
    Shortcut{sequence:"1";enabled:root.toolShortcuts;onActivated:root.actualSize()}
    Shortcut{sequence:"Shift+1";enabled:root.toolShortcuts;onActivated:root.fitAll()}
    property real zoom: 1
    property real panX: 40
    property real panY: 40

    component Picker: ComboBox {
        id:picker
        padding:0;leftPadding:0;rightPadding:0;topPadding:0;bottomPadding:0
        implicitHeight:30
        implicitWidth:Math.ceil(contentItem.implicitWidth)
        property real widestLabel: {
            let width=0
            for(let i=0;i<count;i++){ width=Math.max(width,labelMetrics.advanceWidth(textAt(i))) }
            return Math.ceil(width)
        }
        FontMetrics{id:labelMetrics;font:picker.font}
        Layout.preferredWidth:implicitWidth
        Layout.minimumWidth:implicitWidth
        font.pixelSize:13
        background:Rectangle{color:picker.hovered||picker.popup.opened?"#29313e":"transparent";radius:4}
        indicator:Canvas{x:picker.width-18;y:(picker.height-height)/2;width:10;height:6;onPaint:{let c=getContext("2d");c.strokeStyle="#a8b4c5";c.lineWidth=1.5;c.beginPath();c.moveTo(1,1);c.lineTo(5,5);c.lineTo(9,1);c.stroke()}}
        contentItem:Text{text:picker.displayText;leftPadding:8;rightPadding:28;verticalAlignment:Text.AlignVCenter;color:"#e4eaf3";font:picker.font;elide:Text.ElideNone}
        popup:Popup {
            y:picker.height+5;width:Math.max(picker.width,picker.widestLabel+48);padding:4
            implicitHeight:Math.min(contentItem.implicitHeight+8,400)
            background:Rectangle{color:"#222a35";radius:5;border.color:"#414d5f"}
            contentItem:ListView{clip:true;implicitHeight:contentHeight;model:picker.popup.visible?picker.delegateModel:null;currentIndex:picker.highlightedIndex;ScrollIndicator.vertical:ScrollIndicator{}}
        }
        delegate:ItemDelegate {
            required property var modelData;required property int index
            id:option
            width:picker.popup.width-8;height:30
            padding:0;leftPadding:8;rightPadding:28
            highlighted:picker.highlightedIndex===index
            contentItem:Text{text:picker.textAt(index);color:"#e4eaf3";font:picker.font;verticalAlignment:Text.AlignVCenter}
            indicator:Text{visible:index===picker.currentIndex;text:"✓";font:picker.font;color:"#a8b4c5";width:20;height:parent.height;x:parent.width-width-4;horizontalAlignment:Text.AlignHCenter;verticalAlignment:Text.AlignVCenter}
            background:Rectangle{radius:3;color:parent.highlighted?"#35445b":"transparent"}
        }
    }
    header: Rectangle {
        objectName: "projectToolbar"
        color: "#1c222d"; height: 42
        RowLayout {
            anchors.fill:parent;anchors.margins:5;spacing:6
            Picker {
                id:projectPicker;objectName:"projectPicker"
                model:root.projects;textRole:"name";valueRole:"id"
                currentIndex:root.projects.findIndex(p=>p.id===root.selection.projectId)
                displayText:currentIndex<0?"Choose project":currentText
                onActivated: {let demo=root.demos.find(d=>d.projectId===currentValue);if(demo)workspace.call("selection.set",{projectId:currentValue,demoId:demo.id})}
            }
            Label {visible:projectPicker.currentIndex>=0;text:"/";color:"#647187";font.pixelSize:20}
            Picker {
                id:demoPicker;objectName:"demoPicker"
                visible:projectPicker.currentIndex>=0
                model:root.demos.filter(d=>d.projectId===projectPicker.currentValue);textRole:"name";valueRole:"id"
                currentIndex:model.findIndex(d=>d.id===root.selection.demoId)
                displayText:currentIndex<0?"Choose demo":currentText
                onActivated:workspace.call("selection.set",{projectId:projectPicker.currentValue,demoId:currentValue})
            }
            Picker {objectName:"paneNavigator";visible:demoPicker.visible&&demoPicker.currentIndex>=0;model:root.activeDemo.panes;textRole:"name";valueRole:"id";currentIndex:model.findIndex(p=>p.id===root.selectedPane);displayText:currentIndex<0?"Focus pane":currentText;onActivated:root.focusPane(currentValue)}
            Item {Layout.fillWidth:true}

        }
        Rectangle {anchors.bottom:parent.bottom;width:parent.width;height:1;color:"#303a49"}
    }
    Item {
        anchors.fill:parent
        Item {
            id:canvasArea;objectName:"demoCanvas";anchors.fill:parent;anchors.rightMargin:root.inspectorOpen?inspectorDock.width:0;clip:true
            onWidthChanged: {if(root.overview)fitTimer.restart()}
            onHeightChanged: {if(root.overview)fitTimer.restart()}
                    Rectangle{anchors.fill:parent;color:"#131923"}
                    Canvas {
                        // Move a cached grid by its phase; the canvas only paints on resize.
                        x: root.panX % 24 - 24
                        y: root.panY % 24 - 24
                        width: parent.width + 72
                        height: parent.height + 72
                        onWidthChanged: requestPaint()
                        onHeightChanged: requestPaint()
                        onPaint: {
                            let c = getContext("2d")
                            c.reset()
                            c.fillStyle = "#283140"
                            for (let x = 0; x < width; x += 24)
                                for (let y = 0; y < height; y += 24)
                                    c.fillRect(x, y, 1, 1)
                        }
                    }
                    MouseArea {
                        objectName:"canvasBackground";anchors.fill:parent;acceptedButtons:Qt.LeftButton|Qt.MiddleButton
                        cursorShape:pressed?Qt.ClosedHandCursor:Qt.OpenHandCursor
                        property point origin
                        onPressed:mouse=>{origin=Qt.point(mouse.x,mouse.y);engines.dismissSelectPopups()}
                        onPositionChanged:mouse=>{if(pressed){root.overview=false;root.panX+=mouse.x-origin.x;root.panY+=mouse.y-origin.y;origin=Qt.point(mouse.x,mouse.y)}}
                        onWheel:wheel=>root.canvasWheel(wheel)
                    }
                    Item {
                        x:root.panX;y:root.panY;scale:root.zoom;transformOrigin:Item.TopLeft
                        Repeater{model:root.activeDemo.panes;delegate:PaneView{required property var modelData;pane:modelData;host:root}}
                    }
                    Column {anchors.centerIn:parent;spacing:14;visible:!root.selection.demoId
                        Label{anchors.horizontalCenter:parent.horizontalCenter;text:"A workspace for your interfaces";font.pixelSize:24;color:"#dfe7f3"}
                        Label{anchors.horizontalCenter:parent.horizontalCenter;text:root.projects.length?"Choose a project and demo above to begin.":"Ask your AI to add a project through DerpDesign MCP.";color:"#93a3ba"}
                    }
        }
        Rectangle {
            objectName:"toolDock";anchors.left:parent.left;anchors.bottom:parent.bottom;anchors.margins:12
            width:toolRow.implicitWidth+8;height:44;radius:8;color:"#ed202733";border.color:"#3a4658"
            Row {id:toolRow;anchors.centerIn:parent;spacing:2
                    ToolTile {objectName:"mode-hand";text:"Pan";symbol:"✥";checked:root.mode==="hand";hint:"Drag the canvas · H";onClicked:root.chooseTool("hand")}
                    ToolTile {objectName:"mode-interact";text:"Pointer";symbol:"↖";checked:root.mode==="interact";hint:"Use the app; drag headers to move panes · V";onClicked:root.chooseTool("interact")}
                    ToolTile {objectName:"mode-inspect";text:"Inspect";symbol:"⌖";checked:root.mode==="inspect";hint:"Pick an element to inspect · I";onClicked:root.chooseTool("inspect")}
            }
        }
        Rectangle {
            anchors.right:canvasArea.right;anchors.bottom:parent.bottom;anchors.margins:12
            width:zoomRow.implicitWidth+8;height:44;radius:8;color:"#ed202733";border.color:"#3a4658"
            Row {id:zoomRow;anchors.centerIn:parent;spacing:3
                ActionButton{objectName:"zoom-fit-all";text:"Fit all";quiet:true;hint:"Show every pane · Shift+1";onClicked:root.fitAll()}
                ActionButton{objectName:"zoom-fit-pane";text:"Fit pane";quiet:true;enabled:!!root.selectedPane;onClicked:root.fitPane()}
                ActionButton{objectName:"zoom-actual";text:"100%";quiet:true;hint:"Actual size at your display scale · 1";onClicked:root.actualSize()}
                ActionButton{text:"−";quiet:true;onClicked:root.zoomAround(root.zoom/1.2)}
                Label{objectName:"zoom-label";text:Math.round(root.zoom/root.actualScale*100)+"%";width:42;height:34;verticalAlignment:Text.AlignVCenter;horizontalAlignment:Text.AlignHCenter;color:"#bdc9da"}
                ActionButton{text:"+";quiet:true;onClicked:root.zoomAround(root.zoom*1.2)}
            }
        }
        Rectangle {
            id:inspectorDock;objectName:"contextPanel";visible:root.inspectorOpen
            anchors.top:parent.top;anchors.right:parent.right;anchors.bottom:parent.bottom
            width:Math.min(Math.max(300,root.inspectorWidth),parent.width*0.65);color:"#1c222d"
            Rectangle{anchors.left:parent.left;height:parent.height;width:1;color:"#3a4658"}
            MouseArea {
                objectName:"inspectorResizeHandle";anchors.left:parent.left;anchors.top:parent.top;anchors.bottom:parent.bottom;width:7;cursorShape:Qt.SizeHorCursor
                property real startX;property real startWidth
                onPressed:mouse=>{startX=mapToItem(null,mouse.x,mouse.y).x;startWidth=inspectorDock.width}
                onPositionChanged:mouse=>{if(pressed)root.inspectorWidth=Math.max(300,Math.min(parent.parent.width*0.65,startWidth+startX-mapToItem(null,mouse.x,mouse.y).x))}
            }
            ColumnLayout {anchors.fill:parent;anchors.margins:12;anchors.leftMargin:16;spacing:8
                RowLayout{Label{text:"Inspector";font.pixelSize:14;Layout.fillWidth:true}ActionButton{text:"×";quiet:true;onClicked:{root.panelOpen=false;root.cancelInspectHover();root.mode="interact"}}}
                Label{text:root.selectedPaneName||"Pick a pane";font.pixelSize:12;Layout.fillWidth:true;elide:Text.ElideRight;color:"#8596ae"}
                Inspector{objectName:"inspector";Layout.fillWidth:true;Layout.fillHeight:true;inspection:root.inspection;paneId:root.selectedPane;onSelectSelector:selector=>root.requestInspection(root.selectedPane,{selector,framePath:(root.inspection.element||{}).framePath||[]},"select")}
            }
        }
        Rectangle {
            visible:workspace.error.length>0;anchors.top:parent.top;anchors.horizontalCenter:parent.horizontalCenter;width:Math.min(parent.width-24,700);height:errorRow.implicitHeight+16;color:"#442b32";radius:6
            RowLayout{id:errorRow;anchors.fill:parent;anchors.margins:8;Label{text:workspace.error;wrapMode:Text.Wrap;Layout.fillWidth:true;color:"#ffd8d8"}ActionButton{text:"Dismiss";onClicked:workspace.clearError()}}
        }
    }
    Connections {
        target: workspace
        function onOperationFailed(method,clientRequestId){if(method==="pane.inspect"&&clientRequestId===root.hoverInFlight){root.hoverInFlight="";if(root.pendingHover)hoverInspectTimer.start()}}
        function onOperationCompleted(method, result) {
            if(method==="pane.inspect" && result.clientRequestId===root.hoverInFlight){root.hoverInFlight="";if(root.pendingHover)hoverInspectTimer.start()}
            if(method==="pane.inspect" && result.clientRequestId && result.clientRequestId===(result.clientPurpose==="hover"?root.latestInspectRequest:root.selectedInspectRequest) && result.generation===root.selection.generation && root.mode==="inspect") {
                if(result.clientPurpose==="hover"){root.inspectionPreview=result;root.inspectionPreviewPane=result.paneId}
                else if(result.paneId===root.selectedPane){root.inspection=result;root.inspectionPreview=({});root.inspectionPreviewPane="";root.panelOpen=true;root.panelTab=1}
            }
        }
    }

}
