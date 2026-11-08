const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
let js=0,json=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 if(['.git','node_modules','artifacts'].includes(e.name)) continue;
 const file=path.join(dir,e.name);
 if(e.isDirectory())walk(file);
 else if(file.endsWith('.json')){JSON.parse(fs.readFileSync(file,'utf8'));json++;}
 else if(file.endsWith('.js')){new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});js++;}
}}
walk('.');
const config=require('../project.config.json');
const app=require('../miniprogram/app.json');
if(config.miniprogramRoot!=='miniprogram/')throw Error('工程路径不匹配');
for(const page of app.pages){
 for(const ext of ['js','json','wxml'])if(!fs.existsSync('miniprogram/'+page+'.'+ext))throw Error('缺少页面文件 '+page+'.'+ext);
 const file=path.resolve('miniprogram/'+page+'.js');let definition;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Page:p=>{definition=p;},Date});
 const markup=fs.readFileSync('miniprogram/'+page+'.wxml','utf8');
 // WXML expressions are not XML entity-decoded: &amp;&amp; is invalid inside {{ }}.
 // This syntax check catches malformed expressions; it does not replace WeChat's compiler.
 for(const expression of markup.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
  try { new vm.Script('('+expression[1]+')'); }
  catch(error) { throw Error(page+' WXML表达式语法错误：'+expression[1]+'；'+error.message); }
 }

 for(const event of markup.matchAll(/(?:bind|catch)[a-z]+=["']([A-Za-z_$][\w$]*)["']/g)){
  if(typeof definition[event[1]]!=='function')throw Error(page+' 缺少事件方法 '+event[1]);
 }
}
for(const relative of Object.values(app.usingComponents || {})) {
 const prefix='miniprogram/'+relative.replace(/^\//,'');
 for(const ext of ['js','json','wxml','wxss'])if(!fs.existsSync(prefix+'.'+ext))throw Error('缺少组件文件 '+prefix+'.'+ext);
 if(!JSON.parse(fs.readFileSync(prefix+'.json','utf8')).component)throw Error('缺少component配置');
 const file=path.resolve(prefix+'.js');let component;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Component:c=>{component=c;},Date});
 const markup=fs.readFileSync(prefix+'.wxml','utf8');
 for(const expression of markup.matchAll(/\{\{([\s\S]*?)\}\}/g))new vm.Script('('+expression[1]+')');
 for(const event of markup.matchAll(/(?:bind|catch)[a-z]+=["']([A-Za-z_$][\w$]*)["']/g))if(typeof component.methods[event[1]]!=='function')throw Error('缺少组件事件 '+event[1]);
}
console.log(`JS语法 ${js} 文件、JSON ${json} 文件、${app.pages.length} 个页面入口及自定义组件检查通过（不等于微信编译验证）`);
