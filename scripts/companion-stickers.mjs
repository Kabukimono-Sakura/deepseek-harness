import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {projectRoot} from './project-env.mjs';
import {relevance} from '../src/core/companion.ts';
const run=promisify(execFile);
const site='https://xn--pssy23gqgbz2d718b.com';
const folder=join(projectRoot,'data/companion/stickers');
const catalogPath=join(folder,'catalog.json');
export function readCatalog(){
  if(!existsSync(catalogPath))return [];
  return JSON.parse(readFileSync(catalogPath,'utf8')).items;
}
async function getJson(url){
  const {stdout}=await run(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--fail','--proto','=https','--connect-timeout','10','--max-time','35','--max-filesize','8000000',url],{encoding:'utf8',maxBuffer:8_000_000,windowsHide:true});
  return JSON.parse(stdout);
}
export function validImageUrl(value){
  try{const url=new URL(value);return url.protocol==='https:' && url.hostname==='raw.githubusercontent.com' && url.pathname.startsWith('/lmy414/ai-girl-stickers/') && !url.username && !url.password && !url.search && !url.hash;}catch{return false;}
}
export async function refreshCatalog(){
  mkdirSync(folder,{recursive:true});
  const first=await getJson(site+'/open-api/v1/works/page/1.json');
  if(!Number.isInteger(first.totalPages)||first.totalPages<1||first.totalPages>100)throw new Error('Invalid sticker index');
  const pages=[first];
  for(let start=2;start<=first.totalPages;start+=3){
    pages.push(...await Promise.all(Array.from({length:Math.min(3,first.totalPages-start+1)},(_,i)=>getJson(site+`/open-api/v1/works/page/${start+i}.json`))));
  }
  const items=pages.flatMap(page=>page.items).filter(item=>/^sticker_[a-f0-9]+$/.test(item.id)&&validImageUrl(item.image?.originalUrl)).map(item=>({
    id:item.id,name:String(item.name).slice(0,160),description:String(item.description??'').slice(0,800),tags:item.tags,
    characterId:item.characterId,categories:item.categoryIds,url:item.url,license:item.license,
    imageUrl:item.image.originalUrl,sha256:item.image.sha256
  }));
  const temp=catalogPath+'.'+randomUUID()+'.tmp';
  writeFileSync(temp,JSON.stringify({fetchedAt:new Date().toISOString(),source:site,items}));renameSync(temp,catalogPath);
  return items.length;
}
export function chooseStickers(catalog,query){
  // Description matching plus rotation avoids repeating the same handful of images.
  return catalog.filter(item=>item.characterId==='deepseek').map(item=>({item,score:relevance(query,item.name+' '+item.description+' '+item.tags?.join(' '))+Math.random()*2}))
    .sort((a,b)=>b.score-a.score).slice(0,24).map(({item})=>item);
}
export async function stickerFile(catalog,id){
  const item=catalog.find(item=>item.id===id);
  if(!item||!validImageUrl(item.imageUrl))throw new Error('Unknown sticker');
  mkdirSync(folder,{recursive:true});
  const path=join(folder,id+'.img');
  const verify=()=>{
    const bytes=readFileSync(path);const header=bytes.subarray(0,16);
    const isImage=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header.subarray(0,3).equals(Buffer.from([255,216,255]))||/^GIF8[79]a/.test(header.toString())||(header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP');
    if(!bytes.length||bytes.length>20_000_000||!isImage)throw new Error('Invalid sticker file');
    if(item.sha256&&createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Sticker hash mismatch');
  };
  if(!existsSync(path)){
    const part=path+'.'+randomUUID()+'.part';
    try{await run(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--fail','--proto','=https','--connect-timeout','10','--max-time','40','--max-filesize','20000000',item.imageUrl,'--output',part],{windowsHide:true});renameSync(part,path);}finally{if(existsSync(part))unlinkSync(part);}
  }
  try{verify();}catch(error){unlinkSync(path);throw error;}
  return pathToFileURL(path).href;
}
if(process.argv.includes('--refresh'))console.log(JSON.stringify({stickers:await refreshCatalog()}));

