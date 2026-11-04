import {createHash} from 'node:crypto';
export const disclosure='本文由 AI 辅助创作，请结合文中来源核实相关信息。';
export function validateArticle(value){
 if(!value||typeof value!=='object')throw Error('文章必须是 JSON 对象');
 for(const [key,max] of [['title',32],['author',16],['digest',120]])if(typeof value[key]!=='string'||!value[key].trim()||[...value[key]].length>max)throw Error(key+' 不能为空或超过 '+max+' 字');
 if(!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.some(p=>typeof p!=='string'||!p.trim()))throw Error('正文必须是非空纯文本段落数组');
 if(!Array.isArray(value.sources)||value.sources.some(s=>typeof s.title!=='string'||!s.title||!validUrl(s.url)))throw Error('来源需要标题及 HTTPS 链接');
 const article={title:value.title,author:value.author,digest:value.digest,paragraphs:value.paragraphs,sources:value.sources.map(s=>({title:s.title,url:s.url})),aiDisclosure:disclosure};
 if(renderContent(article).length>=20000)throw Error('正文须少于 20000 字符');return article;
}
function validUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function renderContent(article){return '<p><small>'+disclosure+'</small></p>'+article.paragraphs.map(p=>'<p>'+escapeHtml(p).replaceAll('\n','<br>')+'</p>').join('')+(article.sources.length?'<h3>参考来源</h3>'+article.sources.map(s=>'<p>'+escapeHtml(s.title)+'：'+escapeHtml(s.url)+'</p>').join(''):'');}
export function articleHash(article){return createHash('sha256').update(JSON.stringify(validateArticle(article))).digest('hex');}
export function renderPreview(article){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>'+escapeHtml(article.title)+'</title><style>body{max-width:760px;margin:40px auto;padding:24px;font:18px/1.9 system-ui;background:#fff7fa;color:#3c2934}small{color:#86556c}</style><p>本地预览 · 尚未上传或发表</p><h1>'+escapeHtml(article.title)+'</h1><p>'+escapeHtml(article.author)+'</p>'+renderContent(article)+'</html>';}
