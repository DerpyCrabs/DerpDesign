import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ColumnLayout {
    id: inspector
    required property var inspection
    required property string paneId
    signal selectSelector(string selector)
    property var element: inspection.element || ({})
    property var styles: inspection.computedStyles || ({})
    property var expanded: ({})
    property string selectedSelector: (element.selectors || [])[0] || ""
    onInspectionChanged: revealSelection.restart()
    Timer{id:revealSelection;interval:0;onTriggered:{
        let selectors=inspector.element.selectors||[],rows=inspector.rows
        let index=rows.findIndex(row=>selectors.includes(row.selector)||selectors.some(selector=>selector[0]==="#"&&row.label.includes(selector)))
        if(index>=0){inspector.selectedSelector=rows[index].selector;tree.positionViewAtIndex(index,ListView.Contain)}
    }}
    property var rows: flatten((inspection.dom || {}).root, "", 0)
    function flatten(node, path, depth) {
        if (!node) return []
        if (node.nodeType !== 1) {
            let result=[];for(let child of node.children || [])result.push(...flatten(child,path,depth));return result
        }
        let tag=(node.localName || node.nodeName || "element").toLowerCase()
        let selector=path || tag, attrs=node.attributes || [], label=tag
        for(let i=0;i<attrs.length;i+=2) {
            if(attrs[i]==="id")label+="#"+attrs[i+1]
            if(attrs[i]==="class")label+="."+attrs[i+1].trim().split(/\s+/).join(".")
        }
        let children=(node.children || []).filter(n=>n.nodeType===1), open=expanded[selector]!==false
        let attributeSummary=[]
        for(let i=0;i<attrs.length;i+=2)attributeSummary.push(attrs[i]+'="'+attrs[i+1]+'"')
        let out=[{selector,label,depth,attributes:attributeSummary.join(" "),children:children.length,open}]
        if(open && !["script","style"].includes(tag)) {
            let counts={}
            for(let child of children){let name=(child.localName||child.nodeName).toLowerCase();counts[name]=(counts[name]||0)+1;out.push(...flatten(child,selector+" > "+name+":nth-of-type("+counts[name]+")",depth+1))}
        }
        return out
    }
    function toggle(selector){let next=Object.assign({},expanded);next[selector]=expanded[selector]===false;expanded=next}
    function propertiesText(properties) { return properties.filter(p=>!p.disabled).map(p=>"  " + p.name + ": " + p.value + (p.important ? " !important" : "") + ";").join("\n") }
    function rulesText() {
        let matched=inspection.matchedStyles||{},text=[]
        if((matched.inlineStyle?.cssProperties||[]).length)text.push("element.style {\n"+propertiesText(matched.inlineStyle.cssProperties||[])+"\n}")
        for(let match of [...(matched.matchedCSSRules||[])].sort((a,b)=>Number(a.rule?.origin==="user-agent")-Number(b.rule?.origin==="user-agent"))) {let rule=match.rule||{};text.push(((rule.selectorList||{}).text||"Rule")+" {\n"+propertiesText((rule.style||{}).cssProperties||[])+"\n}")}
        return text.join("\n\n")||"No matched rules."
    }
    spacing:6
    Label {textFormat:Text.PlainText;text:inspector.element.tagName?"<"+inspector.element.tagName.toLowerCase()+">":"Pick an element in a pane";color:"#a6c3ef";font.pixelSize:13;Layout.fillWidth:true;elide:Text.ElideRight}
    Label {text:{let b=inspector.element.bounds;return b?Math.round(b.width)+" × "+Math.round(b.height)+"  ·  x "+Math.round(b.x)+"  y "+Math.round(b.y):"Move over a pane to preview an element."} color:"#8596ae";font.pixelSize:11;Layout.fillWidth:true;wrapMode:Text.Wrap}
    Label {text:"Elements";color:"#c6d2e3";font.pixelSize:12}
    ListView {
        id:tree;objectName:"inspectorTree";Layout.fillWidth:true;Layout.fillHeight:true;Layout.minimumHeight:100;clip:true
        model:inspector.rows
        ScrollBar.vertical:ScrollBar{}
        delegate:Rectangle {
            id:treeRow;required property var modelData
            objectName:"dom-row-"+index
            required property int index
            width:tree.width;height:22;color:inspector.selectedSelector===modelData.selector?"#304560":rowMouse.containsMouse?"#252f3d":"transparent"
            MouseArea{id:rowMouse;anchors.fill:parent;hoverEnabled:true;onClicked:{inspector.selectedSelector=modelData.selector;inspector.selectSelector(modelData.selector)}}
            Text {x:8+modelData.depth*12;y:0;width:18;height:parent.height;text:modelData.children?(modelData.open?"▾":"▸"):"";color:"#8596ae";verticalAlignment:Text.AlignVCenter
                MouseArea{anchors.fill:parent;onClicked:inspector.toggle(modelData.selector)}
            }
            Text {x:28+modelData.depth*12;width:Math.max(0,parent.width-x-8);height:parent.height;textFormat:Text.PlainText;text:"<"+modelData.label+(inspector.selectedSelector===modelData.selector&&modelData.attributes?" "+modelData.attributes:"")+">";font.family:"monospace";font.pixelSize:12;color:"#9fc7e8";verticalAlignment:Text.AlignVCenter;elide:Text.ElideRight}
            ToolTip {id:attributeTip;visible:rowMouse.containsMouse;delay:700;text:"<"+modelData.label+(modelData.attributes?" "+modelData.attributes:"")+">\n"+modelData.selector;contentItem:Text{text:attributeTip.text;textFormat:Text.PlainText;color:"#e4edfa";font.pixelSize:12;wrapMode:Text.Wrap}}
        }
    }
    Row {
        id:tabs;property bool computed:false;Layout.fillWidth:true;Layout.preferredHeight:26;spacing:0
        Repeater {model:["Styles","Computed"]
            Rectangle {
                required property string modelData;required property int index
                width:tabs.width/2;height:26;color:tabMouse.containsMouse?"#252f3d":"transparent"
                Text{anchors.centerIn:parent;text:modelData;color:tabs.computed===(index===1)?"#dce7f8":"#8394ab";font.pixelSize:12}
                Rectangle{anchors.bottom:parent.bottom;width:parent.width;height:1;color:tabs.computed===(index===1)?"#82aaff":"#303a49"}
                MouseArea{id:tabMouse;anchors.fill:parent;hoverEnabled:true;onClicked:tabs.computed=index===1}
            }
        }
    }
    TextField {id:filter;implicitHeight:26;visible:tabs.computed;placeholderText:"Filter properties";Layout.fillWidth:true;font.pixelSize:12}
    ScrollView {
        Layout.fillWidth:true;Layout.preferredHeight:230;Layout.minimumHeight:90;clip:true
        TextArea {objectName:"inspectorStyles";text:tabs.computed?Object.keys(inspector.styles).sort().filter(k=>k.includes(filter.text.toLowerCase())).map(k=>k+": "+inspector.styles[k]+";").join("\n"):inspector.rulesText();readOnly:true;selectByMouse:true;font.family:"monospace";font.pixelSize:12;color:"#c5d3e7";padding:8;wrapMode:Text.Wrap;background:Rectangle{color:"#171e28"}}
    }
}
