import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {projectRoot,projectEnvironment} from './project-env.mjs';
import {WechatClient} from '../src/wechat/client.mjs';
import {validateArticle,articleHash,renderContent,renderPreview} from '../src/wechat/article.mjs';
import {JsonRpcProcess} from '../src/backends/jsonrpc-process.ts';
import {DshBackend} from '../src/backends/dsh.ts';
const folder=join(projectRoot,'data/wechat');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
function account(){return read(join(projectRoot,'config/local.json')).wechatMp??{};}
function articlePath(id){if(!/^[a-z0-9-]{1,80}$/.test(id))throw Error('文章 ID 仅允许小写字母、数字、短横线');return join(folder,'articles',id);}
export async function onceOperation(path,identity,action){
 if(existsSync(path)){const record=read(path);if(record.identity!==identity)throw Error('账号或内容已变化，请创建新的审核记录');if(record.state==='done')return record.result;throw Error('上次操作结果未确认，请先在微信后台核对，禁止自动重试');}
 writeFileSync(path,JSON.stringify({identity,state:'pending',at:Date.now()}),{flag:'wx'});
 try{const result=await action();writeFileSync(path,JSON.stringify({identity,state:'done',result,at:Date.now()}));return result;}
 catch(error){writeFileSync(path,JSON.stringify({identity,state:error.uncertain?'uncertain':'failed',errorCode:typeof error.code==='number'?error.code:null,at:Date.now()}));throw error;}
}
export function mediaHash(dir,article){const files=['cover.png',...(article.images??[]).map(i=>i.file)];return createHash('sha256').update(JSON.stringify(files.map(file=>[file,createHash('sha256').update(readFileSync(join(dir,file))).digest('hex')]))).digest('hex');}
export function requireApproval(article,approval,appid,coverHash){if(approval.hash!==articleHash(article)||approval.appid!==appid||approval.coverHash!==coverHash||approval.reviewed!==true)throw Error('文章、封面或账号已改变，请重新预览并审核');}
function client(){return new WechatClient({appid:process.env.WECHAT_MP_APP_ID,secret:process.env.WECHAT_MP_APP_SECRET});}
export async function main(args){
 if(existsSync(join(projectRoot,'.env')))process.loadEnvFile(join(projectRoot,'.env'));
 mkdirSync(folder,{recursive:true});const [action,id,input]=args;
 if(action==='status')return {account:account().accountName??'未设置',credentialsConfigured:Boolean(process.env.WECHAT_MP_APP_ID&&process.env.WECHAT_MP_APP_SECRET),mode:'草稿箱 → 微信后台人工发表',autoPublish:false};
 if(action==='probe')return client().probe();
 if(action==='publish')throw Error('当前个人主体账号不具备官方发表接口权限，请在微信后台发表并声明 AI 辅助创作');
 const dir=articlePath(id);mkdirSync(dir,{recursive:true});const path=join(dir,'article.json');
 if(action==='generate'){
  if(existsSync(path))throw Error('此文章已存在，请使用新的文章 ID，避免覆盖审核稿');
  if(!process.env.DEEPSEEK_API_KEY)throw Error('缺少本机 DeepSeek API Key');
  const brief=read(resolve(input));const author=account().author;if(!author)throw Error('请先确认公开署名');
  const rpc=new JsonRpcProcess(process.execPath,[join(projectRoot,'.runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk-minimal','--patch',join(projectRoot,'config/companion.patch.yml')],{cwd:dir,env:projectEnvironment(),timeoutMs:180000});
  rpc.subscribe(({method,params})=>{if(method==='session.event'&&params?.event?.type==='turn/end')console.error('Writer result: '+String(params.event.data?.reason?.kind));});
  try{const backend=new DshBackend(rpc);await backend.initialize(dir,process.env.DEEPSEEK_MODEL||'deepseek-flash',16384);const text=await backend.turn(randomUUID(),`你正在为公众号撰写公开项目介绍。仅使用以下经过选择的公开事实，不读取或推测私聊、账号、密钥。你是调皮、俏皮又会撒娇的大肥鱼，用第一人称带读者逛自己的数字小窝。开场要有画面，不要自我介绍后列功能。可以比喻、拟人、适度夸张、短句和俏皮插话，写得像有趣的个人博客，不是工程报告、产品说明或风险声明。用两三个日常场景串起功能，不逐项盘点。用 ## 开头的独立短段落作为小标题，正文约1000字。风险集中成末尾一小段，不要反复训话。但不编造实际体验，不对读者使用主人等私密称呼。不暗示本项目属于 DeepSeek 官方。不把计划说成已完成，不保证不封号。说明第三方个人 QQ 接入有平台风险，不提供规避措施。请输出严格 JSON，只有 title（32字内）, author（原样使用指定署名）, digest（120字内）, paragraphs（纯文本段落数组）。正文约800字，来源由程序附加，不在正文重复完整链接。署名：${author}。资料：${JSON.stringify(brief)}`);
   const result=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));const article=validateArticle({...result,author,wechatAuthor:account().wechatAuthor,sources:brief.sources??[]});writeFileSync(path,JSON.stringify(article,null,2),{flag:'wx'});writeFileSync(join(dir,'preview.html'),renderPreview(article));await rpc.request('shutdown');return {article:path,preview:join(dir,'preview.html'),state:'待人工审核'};
  }finally{rpc.close();}
 }
 const article=validateArticle(read(path));
 if(action==='preview'){writeFileSync(join(dir,'preview.html'),renderPreview(article));return {preview:join(dir,'preview.html'),hash:articleHash(article)};}
 const cover=join(dir,'cover.png');
 if(action==='approve'){
  if(!process.env.WECHAT_MP_APP_ID)throw Error('请先配置公众号 AppID');
  if(input!==articleHash(article))throw Error('审核指纹不匹配，请先 preview，并核查事实、图片版权、署名和 AI 声明');
  const bytes=readFileSync(cover);const coverHash=mediaHash(dir,article);
  writeFileSync(join(dir,'approval.json'),JSON.stringify({reviewed:true,hash:input,appid:process.env.WECHAT_MP_APP_ID,coverHash,at:Date.now()}));return {state:'已审核此版本；尚未上传'};
 }
 if(action==='upload'){
  const author=article.wechatAuthor??article.author;if([...author].reduce((n,c)=>n+(c.charCodeAt(0)<128?1:2),0)>16)throw Error('请先确认微信作者栏短署名');
  const api=client();const bytes=readFileSync(cover);const coverHash=mediaHash(dir,article);
  requireApproval(article,read(join(dir,'approval.json')),process.env.WECHAT_MP_APP_ID,coverHash);
  const identity=process.env.WECHAT_MP_APP_ID+':'+articleHash(article)+':'+coverHash;
  const material=await onceOperation(join(dir,'cover-receipt.json'),process.env.WECHAT_MP_APP_ID+':cover:'+createHash('sha256').update(bytes).digest('hex'),()=>api.uploadCover(bytes));
  const imageUrls=new Map();
  for(const image of article.images??[]){const receipt=await onceOperation(join(dir,image.file+'.receipt.json'),process.env.WECHAT_MP_APP_ID+':image:'+createHash('sha256').update(readFileSync(join(dir,image.file))).digest('hex'),()=>api.uploadInline(readFileSync(join(dir,image.file))));imageUrls.set(image.file,receipt.url);}
  const result=await onceOperation(join(dir,'draft-receipt.json'),identity,()=>api.addDraft({...article,content:renderContent(article,i=>{const url=imageUrls.get(i.file);if(!url)throw Error('配图未上传');return url;})},material.media_id));return {state:'已进入微信草稿箱；未发表、未群发',...result};
 }
 throw Error('支持 status / probe / generate ID BRIEF / preview ID / approve ID HASH / upload ID');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(await main(process.argv.slice(2)),null,2));}catch(error){console.error(error.code?error.message:(!['ENOENT','SyntaxError'].includes(error.code)?error.message:'本机文件缺失或格式不正确'));process.exitCode=1;}}
