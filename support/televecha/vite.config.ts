import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const source=process.env.TELEVECHA_SOURCE_ROOT;
if(!source) throw Error('Set TELEVECHA_SOURCE_ROOT');
const require=createRequire(resolve(source,'package.json'));
const {effectweb}=await import(resolve(source,'node_modules/@effectweb/compiler/dist/vite.js'));
const {default:tailwindcss}=await import(require.resolve('@tailwindcss/vite'));
export default {root:import.meta.dirname,define:{'import.meta.env.VITE_TELEVECHA_E2E':JSON.stringify('1')},plugins:[{
name:'derpdesign-fixture-cache',enforce:'pre',
resolveId(id,importer){
 if(importer?.split('?')[0]===resolve(source,'src/ui/app/appRuntime.ts') && id==='../../telegram/persistence/store')
  return resolve(import.meta.dirname,'cache-mock.ts');
}
},effectweb(),tailwindcss()],resolve:{alias:[{find:/^effectweb$/,replacement:resolve(source,'node_modules/effectweb/dist/index.js')},{find:/^effectweb\/(.+)$/,replacement:resolve(source,'node_modules/effectweb/dist/$1.js')},{find:'@televecha',replacement:resolve(source,'src')}]},server:{host:'127.0.0.1',port:47852,strictPort:true,fs:{allow:[source,resolve(import.meta.dirname,'../..')]}}};
