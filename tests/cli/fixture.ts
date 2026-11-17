import {resolve} from 'node:path';
export function fixture(root:string,port:number){
 return {project:{id:'cli-real',name:'CLI real engines',sourceRoot:resolve(root,'tests/cli'),supportRoot:resolve(root,'tests/cli'),server:{command:['python3','-m','http.server',String(port),'--bind','127.0.0.1','--directory',resolve(root,'tests/cli')],cwd:root,url:`http://127.0.0.1:${port}`}},demo:{id:'cli-demo',projectId:'cli-real',name:'CLI demo',description:'Real rendering',panes:['chromium','ladybird'].map((engine,i)=>({id:'cli-'+engine,name:engine,engine,viewport:{width:400,height:300,deviceScaleFactor:'display'},position:{x:i*450,y:0},route:'/fixture.html',conditions:{}}))}};
}
