import {exampleDeclarations} from '../examples';
export function declarations({root,projectsRoot,port=47852}:{root:string;projectsRoot:string;port?:number}) {
 const {projects,demos}=exampleDeclarations({root,projectsRoot,ports:{derpbird:47921,televecha:port}});
 return {project:projects.find(project=>project.id==='televecha')!,demos:demos.filter(demo=>demo.projectId==='televecha')};
}
