export class WechatApiError extends Error{
 constructor(code,uncertain=false){super('微信接口未完成：'+code);this.code=code;this.uncertain=uncertain;}
}
export class WechatClient{
 #appid;#secret;#fetch;#token;#expires=0;#flight;
 constructor({appid,secret,request=fetch}){if(!appid||!secret)throw Error('请在本机 .env 配置公众号 AppID 和 AppSecret');this.#appid=appid;this.#secret=secret;this.#fetch=request;}
 async #call(path,body,{token=false,form=false,method='POST'}={}){
  const access=token?await this.token():null;const url=new URL('https://api.weixin.qq.com'+path);if(access)url.searchParams.set('access_token',access);
  let result;try{const response=await this.#fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:form?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:form?body:JSON.stringify(body)});if(!response.ok)throw Error();result=await response.json();}catch{throw new WechatApiError('网络异常，结果未知，请勿自动重试',true);}
  if(result.errcode)throw new WechatApiError(Number(result.errcode));return result;
 }
 async token(){
  if(this.#token&&Date.now()<this.#expires)return this.#token;
  if(this.#flight)return this.#flight;
  this.#flight=(async()=>{const r=await this.#call('/cgi-bin/stable_token',{grant_type:'client_credential',appid:this.#appid,secret:this.#secret,force_refresh:false});if(!r.access_token||!Number.isFinite(r.expires_in))throw new WechatApiError('凭证响应无效');this.#token=r.access_token;this.#expires=Date.now()+Math.max(0,r.expires_in-120)*1000;return this.#token;})().finally(()=>{this.#flight=undefined;});return this.#flight;
 }
 async probe(){const r=await this.#call('/cgi-bin/draft/count',{}, {token:true,method:'GET'});if(!Number.isInteger(r.total_count))throw new WechatApiError('草稿权限响应无效');return {draftCount:r.total_count};}
 async addDraft(article,cover){if(typeof cover!=='string'||!cover.trim())throw Error('需要永久封面素材 ID');const r=await this.#call('/cgi-bin/draft/add',{articles:[{article_type:'news',title:article.title,author:article.author,digest:article.digest,content:article.content,thumb_media_id:cover,need_open_comment:0,only_fans_can_comment:0}]},{token:true});if(!r.media_id)throw new WechatApiError('草稿回执缺失',true);return {media_id:r.media_id};}
 async uploadCover(bytes){
  if(bytes.length>10*1024*1024||bytes.length<8)throw Error('封面必须为 10MB 以内的 PNG/JPEG');
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!png&&!jpg)throw Error('封面格式必须为 PNG/JPEG');
  const form=new FormData();form.append('media',new Blob([bytes],{type:png?'image/png':'image/jpeg'}),png?'cover.png':'cover.jpg');
  const r=await this.#call('/cgi-bin/material/add_material?type=image',form,{token:true,form:true});if(!r.media_id)throw new WechatApiError('封面回执缺失',true);return {media_id:r.media_id};
 }
}
