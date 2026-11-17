#pragma once
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>

// The request is JSON data, never executable source. This fixed program only
// reads readiness, DOM, layout and CSS; no evaluation tool is exposed to
// callers.
inline QString inspection_script(QJsonObject const &request) {
  return QString::fromUtf8(R"JS((request => {
const respond=value=>JSON.stringify({...value,__derpQueryId:request.__derpQueryId});
try {
 let window=globalThis.top, offsetX=0, offsetY=0, framePath=[...(request.framePath||[])];
 function selectorFor(element){
   const parts=[];
   for(let node=element;node&&node.nodeType===1;node=node.parentElement){
     let index=1;for(let previous=node.previousElementSibling;previous;previous=previous.previousElementSibling)if(previous.localName===node.localName)index++;
     parts.unshift(node.localName+':nth-of-type('+index+')');
   }
   return parts.join(' > ');
 }
 for(const selector of framePath){
   const frame=window.document.querySelector(selector);
   if(!frame||!frame.contentWindow)return respond({error:'Frame not found: '+selector+' in '+window.location.href});
   try{if(!frame.contentWindow.document)return respond({error:'Frame document unavailable: '+selector});}catch{return respond({error:'Cross-origin frame inspection is not supported: '+selector});}
   const bounds=frame.getBoundingClientRect();offsetX+=bounds.x+frame.clientLeft;offsetY+=bounds.y+frame.clientTop;window=frame.contentWindow;
 }
 let document=window.document;
 let getComputedStyle=window.getComputedStyle.bind(window);
 let harness=window.__DERPDESIGN__;
 let ready=document.readyState==='complete' && (!harness || harness.ready===true);
 if(harness && harness.error && request.mode==='ready') return respond({error:String(harness.error)});
 if(!ready && request.mode==='ready') return respond({ready:false,documentState:document.readyState,harnessPresent:!!harness});
 if(request.mode==='ready') return respond({ready:true,kind:harness?'harness-and-paint':'document-load-and-paint'});
 let element, count=1, selector=request.selector;
 if(selector){const matches=document.querySelectorAll(selector);count=matches.length;element=matches[0];}
 else if(request.point) element=document.elementFromPoint(request.point.x-offsetX,request.point.y-offsetY);
 else element=document.documentElement;
 if(request.point&&!selector){
   // Coordinates remain relative to the root viewport. Only descend after a
   // successful same-origin hit; inaccessible frames remain selectable boundaries.
   for(let depth=0;element&&element.localName==='iframe'&&depth<32;depth++){
     const frame=element, bounds=frame.getBoundingClientRect();
     const nextX=offsetX+bounds.x+frame.clientLeft,nextY=offsetY+bounds.y+frame.clientTop;
     let childWindow,childDocument,hit;
     try{childWindow=frame.contentWindow;childDocument=childWindow?.document;if(!childDocument)break;hit=childDocument.elementFromPoint(request.point.x-nextX,request.point.y-nextY);}catch{break;}
     if(!hit)break;
     framePath.push(selectorFor(frame));offsetX=nextX;offsetY=nextY;window=childWindow;document=childDocument;element=hit;
   }
   getComputedStyle=window.getComputedStyle.bind(window);harness=window.__DERPDESIGN__;
   ready=document.readyState==='complete'&&(!harness||harness.ready===true);
 }
 if(!element) return respond({error:'No matching element'});
 if(element.getRootNode()!==document) return respond({error:'Shadow-root inspection is not supported'});
 if(request.geometryOnly){const rect=element.getBoundingClientRect();return respond({geometryOnly:true,element:{tagName:element.localName,framePath,bounds:{x:rect.x+offsetX,y:rect.y+offsetY,width:rect.width,height:rect.height}}});}
 if(!selector){selector=selectorFor(element);count=document.querySelectorAll(selector).length;}
 const rect=element.getBoundingClientRect();
 const computed=getComputedStyle(element), computedStyles={};
 for(let i=0;i<computed.length;i++){const name=computed.item(i);computedStyles[name]=computed.getPropertyValue(name);}
 const properties=style=>Array.from(style).map(name=>({name,value:style.getPropertyValue(name),important:style.getPropertyPriority(name)==='important'}));
 const matchedCSSRules=[],unavailableStyleSheets=[],unavailableRuleGroups=[];
 function rules(list,source){for(const rule of list){
   if(rule.selectorText && element.matches(rule.selectorText)) matchedCSSRules.push({rule:{selectorList:{text:rule.selectorText},style:{cssProperties:properties(rule.style)},origin:'regular',sourceURL:source}});
   if(rule.cssRules){
     const kind=rule.constructor.name;
     if(kind==='CSSMediaRule'&&!window.matchMedia(rule.conditionText).matches)continue;
     if(kind==='CSSSupportsRule'&&!window.CSS.supports(rule.conditionText))continue;
     if(kind==='CSSContainerRule'){unavailableRuleGroups.push({source,condition:rule.conditionText,reason:'Container matching unavailable through CSSOM'});continue;}
     rules(rule.cssRules,source);
   }
 }}
 for(const sheet of document.styleSheets){if(sheet.disabled || (sheet.media.mediaText&&!window.matchMedia(sheet.media.mediaText).matches))continue;try{rules(sheet.cssRules,sheet.href||document.URL);}catch(error){unavailableStyleSheets.push({url:sheet.href,error:String(error)});}}
 function tree(node){const result={nodeType:node.nodeType,nodeName:node.nodeName,localName:node.localName||'',nodeValue:node.nodeValue||'',children:Array.from(node.childNodes).map(tree)};if(node.attributes)result.attributes=Array.from(node.attributes).flatMap(a=>[a.name,a.value]);return result;}
 const frames=Array.from(document.querySelectorAll('iframe')).map(frame=>{try{return {src:frame.getAttribute('src'),ready:frame.contentWindow?.__DERPDESIGN__?.ready,stage:frame.contentWindow?.__DERPDESIGN__?.stage,error:frame.contentWindow?.__DERPDESIGN__?.error,text:frame.contentDocument?.body?.innerText?.slice(0,200),frames:Array.from(frame.contentDocument?.querySelectorAll('iframe')||[]).map(f=>({src:f.getAttribute('src'),ready:f.contentWindow?.__DERPDESIGN__?.ready,error:f.contentWindow?.__DERPDESIGN__?.error,text:f.contentDocument?.body?.innerText?.slice(0,200)}))}}catch{return {src:frame.getAttribute('src'),inaccessible:true}}});
 return respond({frames,ready,documentState:document.readyState,harnessPresent:!!harness,harnessError:harness?.error||null,harnessStage:harness?.stage||null,element:{tagName:element.localName,text:element.textContent||'',selectors:[selector],matchCount:count,framePath,bounds:{x:rect.x+offsetX,y:rect.y+offsetY,width:rect.width,height:rect.height}},computedStyles,matchedStyles:{inlineStyle:{cssProperties:properties(element.style)},matchedCSSRules},dom:{root:tree(document)},matchedRuleScope:'author-cssom',unavailableStyleSheets,unavailableRuleGroups});
} catch(error) { return respond({error:String(error)}); }
})()JS") +
         QString::fromUtf8(
             QJsonDocument(request).toJson(QJsonDocument::Compact)) +
         ")";
}
