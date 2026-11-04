import {createHash} from 'node:crypto';
export const disclosure='本文由 AI 辅助创作，请结合文中来源核实相关信息。';
export function validateArticle(value){
 if(!value||typeof value!=='object')throw Error('文章必须是 JSON 对象');
 for(const [key,max] of [['title',32],['author',16],['digest',120]])if(typeof value[key]!=='string'||!value[key].trim()||[...value[key]].length>max)throw Error(key+' 不能为空或超过 '+max+' 字');
 if(!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.some(p=>typeof p!=='string'||!p.trim()))throw Error('正文必须是非空纯文本段落数组');
 if(!Array.isArray(value.sources)||value.sources.some(s=>typeof s.title!=='string'||!s.title||!validUrl(s.url)))throw Error('来源需要标题及 HTTPS 链接');
 if(value.wechatAuthor!==undefined&&(typeof value.wechatAuthor!=='string'||!value.wechatAuthor.trim()||[...value.wechatAuthor].reduce((n,c)=>n+(c.charCodeAt(0)<128?1:2),0)>16))throw Error('微信作者栏需使用不超过16个英文字符或8个汉字的短署名');
 const images=value.images??[];
 if(!Array.isArray(images)||images.length>8||images.some(i=>!i||!Number.isInteger(i.afterParagraph)||i.afterParagraph<0||i.afterParagraph>=value.paragraphs.length||!/^figure-[a-z0-9-]+\.(png|jpg)$/.test(i.file)||typeof i.caption!=='string'||i.caption.length>200))throw Error('配图需使用本地 figure- 文件名、有效段落位置及说明');
 const article={...(value.wechatAuthor?{wechatAuthor:value.wechatAuthor}:{}),images:images.map(i=>({file:i.file,afterParagraph:i.afterParagraph,caption:i.caption})),title:value.title,author:value.author,digest:value.digest,paragraphs:value.paragraphs,sources:value.sources.map(s=>({title:s.title,url:s.url})),aiDisclosure:disclosure};
 if(renderContent(article).length>=20000)throw Error('正文须少于 20000 字符');return article;
}
function validUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function renderContent(article,imageUrl=i=>i.file){
 const paragraphs=article.paragraphs.map((p,index)=>{
  const text=escapeHtml(p).replaceAll('\n','<br>');
  const paragraph=p.startsWith('## ')?'<h2 style="font-size:22px;color:#aa3f69;margin-top:36px">'+escapeHtml(p.slice(3))+'</h2>':'<p style="line-height:1.9;margin:18px 0">'+text+'</p>';
  return paragraph+(article.images??[]).filter(i=>i.afterParagraph===index).map(i=>'<section style="margin:26px 0"><img style="width:100%;border-radius:12px" src="'+escapeHtml(imageUrl(i))+'" alt="'+escapeHtml(i.caption)+'"><p style="font-size:13px;color:#8b6b7b;text-align:center">'+escapeHtml(i.caption)+'</p></section>').join('');
 }).join('');
 return '<p><small>'+disclosure+'</small></p>'+paragraphs+(article.sources.length?'<h3>项目入口</h3>'+article.sources.map(s=>'<p>'+escapeHtml(s.title)+'：'+escapeHtml(s.url)+'</p>').join(''):'');
}
export function articleHash(article){return createHash('sha256').update(JSON.stringify(validateArticle(article))).digest('hex');}
export function renderPreview(article){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' file: data:"><title>'+escapeHtml(article.title)+'</title><style>body{max-width:760px;margin:40px auto;padding:24px;font:18px/1.9 system-ui;background:#fff7fa;color:#3c2934}small{color:#86556c}</style><p>本地预览 · 尚未上传或发表</p><h1>'+escapeHtml(article.title)+'</h1><p>'+escapeHtml(article.author)+(article.wechatAuthor?' · 微信作者栏：'+escapeHtml(article.wechatAuthor):'')+'</p><img style="width:100%;border-radius:12px" src="cover.png" alt="文章封面">'+renderContent(article)+'</html>';}
