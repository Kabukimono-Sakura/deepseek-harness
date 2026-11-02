import type {QqStore} from './qq-store.ts';
import {OneBotRequestError} from '../channels/onebot-client.ts';
type Options = {accountId:string;allowedUsers:readonly string[];enabled:boolean;store:QqStore;
    transport:{readonly ready:boolean;request:(action:string,params:unknown)=>Promise<unknown>};log?:(event:string)=>void};
export class FriendApprover {
  #options: Options;
  #running?:Promise<void>;
  #stopped=false;
  constructor(options:Options) {this.#options=options;}
  receive(value:unknown):void {
    if(this.#stopped||!this.#options.enabled||!value||typeof value!=='object')return;
    const event=value as Record<string,unknown>;
    if(event.post_type!=='request'||event.request_type!=='friend'||String(event.self_id)!==this.#options.accountId)return;
    if(typeof event.user_id==='number'&&!Number.isSafeInteger(event.user_id))return;
    const userId=String(event.user_id);
    if(!/^[1-9]\d*$/.test(userId)||!this.#options.allowedUsers.includes(userId))return;
    if(typeof event.flag!=='string'||!event.flag.trim()||event.flag.length>2048)return;
    this.#options.store.queueFriend(this.#options.accountId,userId,event.flag);void this.pump();
  }
  pump():Promise<void> {
    if(this.#running)return this.#running;
    this.#running=this.#drain().catch(()=>this.#options.log?.('friend-approval-error')).finally(()=>{this.#running=undefined;});
    return this.#running;
  }
  async #drain():Promise<void>{
    const {store,transport,accountId,allowedUsers,enabled,log}=this.#options;
    while(!this.#stopped&&enabled&&transport.ready){
      const row=store.nextFriend();if(!row)return;
      if(row.account_id!==accountId||!allowedUsers.includes(row.user_id)){store.friendState(row.id,'ignored');continue;}
      store.friendState(row.id,'sending');
      try{await transport.request('set_friend_add_request',{flag:row.flag,approve:true});store.friendState(row.id,'approved');log?.('friend-approved');}
      catch(error){const uncertain=!(error instanceof OneBotRequestError)||error.uncertain;store.friendState(row.id,uncertain?'uncertain':'queued');log?.(uncertain?'friend-approval-needs-review':'friend-approval-waiting');if(!uncertain)return;}
    }
  }
  async stop():Promise<void>{this.#stopped=true;await this.#running;}
}
