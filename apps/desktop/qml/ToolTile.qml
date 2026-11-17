import QtQuick
import QtQuick.Controls
ActionButton {
    id:tile
    property string symbol
    property string shortcut
    implicitWidth:36;implicitHeight:36;checkable:true;quiet:true;padding:0
    contentItem:Item {
        Canvas {
            id:iconCanvas
            anchors.centerIn:parent;width:20;height:20
            Connections {target:tile;function onCheckedChanged(){iconCanvas.requestPaint()}}
            onPaint:{
                let c=getContext("2d");c.reset();c.strokeStyle=tile.checked?"#ffffff":"#bdc9db";c.lineWidth=1.5;c.lineCap="round";c.lineJoin="round";c.beginPath()
                function line(x,y,a,b){c.moveTo(x,y);c.lineTo(a,b)}
                if(tile.text==="Pointer"){c.moveTo(4,2);c.lineTo(16,11);c.lineTo(10,12);c.lineTo(7,18);c.closePath()}
                else if(tile.text==="Pan"){line(10,2,10,18);line(2,10,18,10);line(7,5,10,2);line(13,5,10,2);line(7,15,10,18);line(13,15,10,18);line(5,7,2,10);line(5,13,2,10);line(15,7,18,10);line(15,13,18,10)}
                else if(tile.text==="Inspect"){c.arc(10,10,5,0,Math.PI*2);line(10,1,10,5);line(10,15,10,19);line(1,10,5,10);line(15,10,19,10)}
                else {c.rect(3,3,14,14);line(7,10,13,10);line(10,7,10,13)}
                c.stroke()
            }
        }
    }
}
