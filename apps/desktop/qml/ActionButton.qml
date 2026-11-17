import QtQuick
import QtQuick.Controls
Button {
    id: control
    property bool quiet: false
    property string hint: ""
    implicitHeight: 34
    implicitWidth: Math.max(34,contentItem.implicitWidth+24)
    padding: 10
    font.pixelSize: 13
    hoverEnabled: true
    contentItem: Text { text: control.text; font: control.font; color: !control.enabled ? "#626c7b" : control.checked ? "#ffffff" : "#dbe2ed"; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight }
    background: Rectangle { radius: 6; color: control.checked ? "#386dde" : control.down ? "#354052" : control.hovered ? "#2d3747" : control.quiet ? "transparent" : "#242c39"; border.color: control.checked ? "#6895ff" : control.quiet ? "transparent" : "#394454" }
    ToolTip.visible: hovered && hint.length>0
    ToolTip.text: hint
    ToolTip.delay: 500
    Accessible.name: text
}
