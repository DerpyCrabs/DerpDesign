import {z} from 'zod';
const target={selector:z.string().min(1),framePath:z.array(z.string()).optional()};
const point=z.object({...target,x:z.number().min(0).max(1).default(.5),y:z.number().min(0).max(1).default(.5)}).strict();
const assertion=z.object({action:z.literal('assert'),...target,exists:z.boolean().default(true),text:z.string().optional(),contains:z.string().optional(),styles:z.record(z.string()).optional(),timeoutMs:z.number().int().min(0).max(30000).default(3000)}).strict();
export const sequenceSchema=z.object({steps:z.array(z.discriminatedUnion('action',[
 z.object({action:z.literal('click'),...target,button:z.enum(['left','right','middle']).default('left')}).strict(),
 z.object({action:z.literal('drag'),from:point,to:point,steps:z.number().int().min(2).max(100).default(12)}).strict(),
 z.object({action:z.literal('type'),...target,text:z.string()}).strict(),
 z.object({action:z.literal('key'),key:z.string().min(1),modifiers:z.array(z.string()).optional()}).strict(),
 assertion,
 z.object({action:z.literal('capture'),label:z.string().min(1)}).strict(),
])).min(1).max(200)}).strict();
export type Sequence=z.input<typeof sequenceSchema>;
export type ToolCall=(name:string,params?:Record<string,unknown>)=>Promise<any>;
/** Only typed MCP input and read-only inspection. Never evaluates page JavaScript. */
export async function runSequence(call:ToolCall,paneId:string,input:unknown){
 const sequence=sequenceSchema.parse(input);
 const before=await call('workspace_info');
 const initial=await call('pane_capture',{paneId}); // Wait for scenario readiness, record exact starting revision.
 const captures=[{label:'initial',...initial}];const steps:Array<{index:number;action:string;status:string}>=[];
 const fingerprint=(c:any)=>`${c.sourceFingerprint}:${c.harnessFingerprint}`;
 async function guard(){const info=await call('workspace_info');if(info.selection.generation!==before.selection.generation||info.selection.demoId!==before.selection.demoId)throw Error('Active demo changed during sequence');}
 async function inspect(t:{selector:string;framePath?:string[]},properties?:string[]){return call('pane_inspect',{paneId,...t,...(properties?{properties}:{})});}
 async function locate(t:{selector:string;framePath?:string[];x?:number;y?:number}){
  const {selector,framePath}=t;const result=await inspect({selector,...(framePath?{framePath}:{})},['display','visibility']);const el=result.element;
  if(el?.matchCount!==1)throw Error(`Expected one element for ${selector}, got ${el?.matchCount??0}`);
  const b=el.bounds;if(!b||b.width<=0||b.height<=0||result.computedStyles?.display==='none'||result.computedStyles?.visibility==='hidden')throw Error(`Element is not visible: ${selector}`);
  return {x:b.x+b.width*(t.x??.5),y:b.y+b.height*(t.y??.5)};
 }
 async function event(event:Record<string,unknown>){await guard();await call('pane_input',{paneId,expectedGeneration:before.selection.generation,event});}
 async function click(t:{selector:string;framePath?:string[]},button='left'){const p=await locate(t);await event({type:'pointer',action:'move',...p});await event({type:'pointer',action:'down',button,...p});await event({type:'pointer',action:'up',button,...p});}
 try{
  for(const [index,step]of sequence.steps.entries()){
   await guard();
   try{
    if(step.action==='click')await click({selector:step.selector,framePath:step.framePath},step.button);
    if(step.action==='type'){await click({selector:step.selector,framePath:step.framePath});await event({type:'text',text:step.text});}
    if(step.action==='key'){await event({type:'key',action:'down',key:step.key,modifiers:step.modifiers});await event({type:'key',action:'up',key:step.key,modifiers:step.modifiers});}
    if(step.action==='drag'){
     const from=await locate(step.from),to=await locate(step.to);let last=from;
     await event({type:'pointer',action:'move',...from});await event({type:'pointer',action:'down',button:'left',...from});
     try{for(let n=1;n<=step.steps;n++){last={x:from.x+(to.x-from.x)*n/step.steps,y:from.y+(to.y-from.y)*n/step.steps};await event({type:'pointer',action:'move',...last});}}
     finally{await event({type:'pointer',action:'up',button:'left',...last});}
    }
    if(step.action==='assert'){
     const deadline=Date.now()+step.timeoutMs;let failure='';
     do{
      await guard();let result:any;
      try{result=await inspect({selector:step.selector,...(step.framePath?{framePath:step.framePath}:{})},Object.keys(step.styles??{}));}
      catch(e){if(!(e instanceof Error)||!/^Error: No matching element$|^No matching element$/.test(e.message))throw e;result={};}
      const exists=!!result.element?.matchCount;
      failure=exists!==step.exists?`Expected ${step.selector} to ${step.exists?'exist':'be absent'}`:!exists?'':step.text!==undefined&&result.element.text!==step.text?`Text mismatch for ${step.selector}`:step.contains!==undefined&&!result.element.text.includes(step.contains)?`Missing text for ${step.selector}`:Object.entries(step.styles??{}).some(([k,v])=>result.computedStyles?.[k]!==v)?`Style mismatch for ${step.selector}`:'';
      if(!failure)break;if(Date.now()>=deadline)throw Error(failure);await new Promise(r=>setTimeout(r,50));
     }while(true);
    }
    if(step.action==='capture'){const capture=await call('pane_capture',{paneId});if(fingerprint(capture)!==fingerprint(initial))throw Error('Sources changed during sequence');captures.push({label:step.label,...capture});}
    steps.push({index,action:step.action,status:'passed'});
   }catch(e){throw Error(`Step ${index+1} (${step.action}): ${e instanceof Error?e.message:String(e)}`);}
  }
  await guard();const final=await call('pane_capture',{paneId});if(fingerprint(final)!==fingerprint(initial))throw Error('Sources changed during sequence');captures.push({label:'final',...final});await guard();
  return {status:'passed' as const,paneId,selection:before.selection,steps,captures,error:undefined};
 }catch(e){
  const error=e instanceof Error?e.message:String(e);let evidence:any;
  try{await guard();evidence=await call('pane_capture',{paneId});}catch{}
  return {status:'failed' as const,paneId,selection:before.selection,steps,captures,error,...(evidence?{failureCapture:evidence}:{})};
 }
}
