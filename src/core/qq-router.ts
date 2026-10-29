import { parseOneBotMessage, createOneBotReply } from '../channels/onebot.ts';
import type { OneBotPolicy, IncomingMessage } from '../channels/onebot.ts';
import { OneBotRequestError } from '../channels/onebot-client.ts';
import { record } from '../backends/jsonrpc-process.ts';
import { QqStore } from './qq-store.ts';
import type { Bubble, ReplyPlan } from './companion.ts';

interface Transport { readonly ready: boolean; request(action: string, params: unknown): Promise<unknown> }
interface Conversation { sessionId: string; resume: boolean; id: string; eventId: string; proactive: boolean; images?: IncomingMessage['images'] }
type Options = { store: QqStore; transport: Transport; policy: OneBotPolicy; accountId: string;
  generate: (conversation: Conversation, text: string) => Promise<string | ReplyPlan>;
  imageFile?: (stickerId: string) => Promise<string>; log?: (event: string) => void;
  settleMs?: number; bubbleDelayMs?: () => number; yieldToNewMessages?: boolean; statelessGeneration?: boolean };
export class QqRouter {
  #options: Options;
  #running?: Promise<void>;
  #stopped = false;
  constructor(options: Options) { this.#options=options; }
  #log(event: string): void { this.#options.log?.(event); }
  receive(event: unknown): void {
    if (this.#stopped) return;
    const parsed=parseOneBotMessage(event,this.#options.policy);
    if (!parsed.accepted || parsed.message.accountId!==this.#options.accountId) return;
    this.enqueue(parsed.message);
  }
  enqueue(message: IncomingMessage): boolean {
    if (this.#stopped || !this.#allowed(message)) return false;
    if (this.#options.store.accept(message)!=='accepted') return false;
    this.#log('message-queued'); void this.pump(); return true;
  }
  pump(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running=this.#drain().catch(()=>{this.#stopped=true;this.#log('storage-or-router-error');}).finally(()=>{this.#running=undefined;});
    return this.#running;
  }
  #allowed(message: IncomingMessage): boolean {
    const {accountId,policy}=this.#options;
    return message.accountId===accountId && policy.allowedUsers.includes(message.senderId)
      && (message.replyTarget.kind==='private' || policy.allowedGroups.includes(message.replyTarget.id));
  }
  async #pause(ms: number): Promise<void> { if(ms>0)await new Promise(resolve=>setTimeout(resolve,ms)); }
  async #drain(): Promise<void> {
    const {store,transport}=this.#options;
    while (!this.#stopped && transport.ready) {
      const row=store.next(); if (!row) return;
      const message=JSON.parse(row.payload) as IncomingMessage;
      if (!this.#allowed(message)) { store.setState(row.event_id,'failed');continue; }
      if (message.expiresAt && Date.now()>=message.expiresAt) {store.setState(row.event_id,'skipped');continue;}
      if (row.state==='received') {
        if(this.#options.settleMs)await this.#pause(this.#options.settleMs);
        if(this.#stopped || !transport.ready)return;
        if (this.#options.yieldToNewMessages && store.newerUserMessage(row)) {store.setState(row.event_id,'superseded');continue;}
        const conversation=store.conversation(row.conversation_id);
        if(conversation.blocked){store.setState(row.event_id,'failed');this.#log('conversation-needs-review');continue;}
        store.setState(row.event_id,'processing');
        try {
          const reply=await this.#options.generate({sessionId:conversation.session_id,resume:conversation.initialized===1,
            id:row.conversation_id,eventId:row.event_id,proactive:message.source==='proactive',images:message.images},message.text);
          if(typeof reply==='string') {if(!reply.trim())throw new Error('Empty reply');store.saveReply(row.event_id,reply);}
          else store.savePlan(row.event_id,reply);
        }catch{
          if(!this.#options.statelessGeneration)store.block(row.conversation_id);
          store.setState(row.event_id,'uncertain');this.#log('generation-needs-review');continue;
        }
      }
      if(this.#stopped || !transport.ready)return;
      const bubbles=store.bubbles(row.event_id);
      if(!bubbles.length){store.setState(row.event_id,'skipped');continue;}
      let completed=true;
      for(const item of bubbles){
        if(item.state==='sent'||item.state==='failed')continue;
        if(item.state!=='ready'){store.setState(row.event_id,'uncertain');completed=false;break;}
        if(item.ordinal>0)await this.#pause(this.#options.bubbleDelayMs?.()??0);
        if(this.#stopped || !transport.ready){store.setState(row.event_id,'ready');return;}
        if((message.expiresAt && Date.now()>=message.expiresAt) || (this.#options.yieldToNewMessages && store.newerUserMessage(row))){
          store.setState(row.event_id,'superseded');completed=false;break;
        }
        const bubble=JSON.parse(item.payload) as Bubble;
        // Image preparation happens before marking a network send as in flight.
        let imageFile: string | undefined;
        if('stickerId' in bubble){
          try{imageFile=await this.#options.imageFile?.(bubble.stickerId);if(!imageFile)throw new Error('Image unavailable');}
          catch{store.bubbleState(row.event_id,item.ordinal,'failed');this.#log('sticker-unavailable');continue;}
        }
        if(this.#stopped || !transport.ready){store.setState(row.event_id,'ready');return;}
        if((message.expiresAt && Date.now()>=message.expiresAt)||(this.#options.yieldToNewMessages && store.newerUserMessage(row))){store.setState(row.event_id,'superseded');completed=false;break;}
        if('text' in bubble && bubble.text.length>4000){store.bubbleState(row.event_id,item.ordinal,'failed');this.#log('reply-too-long');continue;}
        const request=createOneBotReply(message,'text' in bubble ? bubble.text : '[表情]',row.event_id);
        const params: Record<string,unknown>={...request.params};
        if(imageFile)params.message=[{type:'image',data:{file:imageFile}}];
        store.setState(row.event_id,'sending');store.bubbleState(row.event_id,item.ordinal,'sending');
        try{
          const result=record(await transport.request(request.action,params));
          if(!['string','number'].includes(typeof result.message_id))throw new OneBotRequestError('Missing delivery receipt.',true);
          store.bubbleState(row.event_id,item.ordinal,'sent',String(result.message_id));store.setState(row.event_id,'ready');this.#log('bubble-confirmed');
        }catch(error){
          const uncertain=!(error instanceof OneBotRequestError)||error.uncertain;
          store.bubbleState(row.event_id,item.ordinal,uncertain?'uncertain':'ready');
          store.setState(row.event_id,uncertain?'uncertain':'ready');this.#log(uncertain?'delivery-needs-review':'waiting-for-connection');
          if(!uncertain)return;
          completed=false;break;
        }
      }
      if(completed){const failed=store.bubbles(row.event_id).some(item=>item.state==='failed');store.setState(row.event_id,failed?'failed':'sent');this.#log(failed?'reply-partially-delivered':'reply-confirmed');}
    }
  }
  async stop(): Promise<void> {this.#stopped=true;await this.#running;}
}
