import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot} from './project-env.mjs';

export class NapcatLoginClient {
  #credential;#expires=0;#fetch;#token;
  constructor({request=fetch,token=async()=>JSON.parse(await readFile(join(projectRoot,'data/napcat/config/webui.json'),'utf8')).token}={}){this.#fetch=request;this.#token=token;}
  async #post(path,body,credential){
    const response=await this.#fetch('http://127.0.0.1:6099/api/'+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('NapCat login service unavailable');
    const result=await response.json();if(result.code!==0)throw new Error('NapCat did not confirm login operation');return result.data;
  }
  async request(action){
    if(!['CheckLoginStatus','RefreshQRcode'].includes(action))throw new Error('Unsupported login operation');
    if(!this.#credential||Date.now()>=this.#expires){
      const token=await this.#token();if(typeof token!=='string'||!token)throw new Error('NapCat WebUI token unavailable');
      const auth=await this.#post('auth/login',{hash:createHash('sha256').update(token+'.napcat').digest('hex')});
      if(!auth?.Credential||auth.require2FA)throw new Error('Complete NapCat WebUI authentication manually');
      this.#credential=auth.Credential;this.#expires=Date.now()+30*60_000;
    }
    try{return await this.#post('QQLogin/'+action,{},this.#credential);}
    catch(error){this.#credential=undefined;throw error;}
  }
}

export class LiveLoginState {
  #client;#now;#url='';#seen=0;#lastAttempt=0;#flight;#cache;#checked=0;#first=true;
  constructor(client,{now=Date.now}={}){this.#client=client;this.#now=now;}
  get qrUrl(){return this.#url;}
  snapshot(force=false){
    if(this.#flight)return this.#flight;
    if(!force&&this.#cache&&this.#now()-this.#checked<1000)return Promise.resolve(this.#cache);
    this.#flight=this.#read(force).catch(error=>{this.#url='';this.#cache=undefined;throw error;}).finally(()=>{this.#flight=undefined;});return this.#flight;
  }
  async #read(force){
    let state=await this.#client.request('CheckLoginStatus');const now=this.#now();
    if(state.isLogin){this.#url='';this.#cache={phase:'logged-in'};this.#checked=now;return this.#cache;}
    const confirming=state.qrLoginAccepted===true||['qrcode_scanned','initializing'].includes(state.loginPhase);
    if(state.qrcodeurl&&state.qrcodeurl!==this.#url){this.#url=state.qrcodeurl;this.#seen=now;}
    const initial=this.#first&&!state.qrLoginAccepted;
    const expired=!confirming&&(!this.#url||now-this.#seen>=90000);
    if((force||initial||expired)&&(!this.#lastAttempt||now-this.#lastAttempt>=5000)){
      this.#lastAttempt=now;
      const fresh=await this.#client.request('RefreshQRcode');
      if(fresh.qrcodeurl){this.#url=fresh.qrcodeurl;this.#seen=this.#now();}else this.#url='';
      state=await this.#client.request('CheckLoginStatus');
      if(state.qrcodeurl){if(state.qrcodeurl!==this.#url)this.#seen=this.#now();this.#url=state.qrcodeurl;}
      this.#first=false;
    }
    if(state.isLogin){this.#url='';this.#cache={phase:'logged-in'};}
    else this.#cache={phase:state.qrLoginAccepted||['qrcode_scanned','initializing'].includes(state.loginPhase)?'confirm':this.#url?'waiting':'generating',
      refreshedAt:this.#seen,version:this.#url?createHash('sha256').update(this.#url).digest('hex').slice(0,20):null};
    this.#checked=this.#now();return this.#cache;
  }
}
