import { parseOneBotMessage, createOneBotReply } from '../channels/onebot.ts';
import type { OneBotPolicy, IncomingMessage } from '../channels/onebot.ts';
import { OneBotRequestError } from '../channels/onebot-client.ts';
import { record } from '../backends/jsonrpc-process.ts';
import { QqStore } from './qq-store.ts';

interface Transport { readonly ready: boolean; request(action: string, params: unknown): Promise<unknown> }
interface Conversation { sessionId: string; resume: boolean }
export class QqRouter {
  #store: QqStore;
  #transport: Transport;
  #policy: OneBotPolicy;
  #accountId: string;
  #generate: (conversation: Conversation, text: string) => Promise<string>;
  #log: (event: string) => void;
  #running?: Promise<void>;
  #stopped = false;
  #admissions: number[] = [];
  constructor(options: { store: QqStore; transport: Transport; policy: OneBotPolicy; accountId: string;
    generate: (conversation: Conversation, text: string) => Promise<string>; log?: (event: string) => void }) {
    this.#store=options.store; this.#transport=options.transport; this.#policy=options.policy;
    this.#accountId=options.accountId; this.#generate=options.generate; this.#log=options.log ?? (()=>{});
  }
  receive(event: unknown): void {
    if (this.#stopped) return;
    const parsed = parseOneBotMessage(event, this.#policy);
    if (!parsed.accepted || parsed.message.accountId !== this.#accountId) return;
    if (this.#store.get(parsed.message.eventId)) return;
    const now=Date.now(); this.#admissions=this.#admissions.filter(time=>now-time<60_000);
    if (this.#admissions.length>=10) { this.#log('rate-limited'); return; }
    if (this.#store.accept(parsed.message)==='accepted') {
      this.#admissions.push(now); this.#log('message-queued'); void this.pump();
    }
  }
  pump(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running=this.#drain().catch(()=>{ this.#stopped=true; this.#log('storage-or-router-error'); }).finally(()=>{this.#running=undefined;});
    return this.#running;
  }
  #allowed(message: IncomingMessage): boolean {
    return message.accountId===this.#accountId && this.#policy.allowedUsers.includes(message.senderId)
      && (message.replyTarget.kind==='private' || this.#policy.allowedGroups.includes(message.replyTarget.id));
  }
  async #drain(): Promise<void> {
    while (!this.#stopped && this.#transport.ready) {
      const row=this.#store.next(); if (!row) return;
      const message=JSON.parse(row.payload) as IncomingMessage;
      if (!this.#allowed(message)) { this.#store.setState(row.event_id,'failed'); continue; }
      if (row.state==='received') {
        const conversation=this.#store.conversation(row.conversation_id);
        if (conversation.blocked) { this.#store.setState(row.event_id,'failed'); this.#log('conversation-needs-review'); continue; }
        this.#store.setState(row.event_id,'processing');
        try {
          const reply=await this.#generate({sessionId:conversation.session_id,resume:conversation.initialized===1},message.text);
          if (!reply.trim()) throw new Error('Empty reply');
          this.#store.saveReply(row.event_id,reply);
        } catch {
          this.#store.block(row.conversation_id); this.#store.setState(row.event_id,'uncertain');
          this.#log('generation-needs-review'); continue;
        }
      }
      if (this.#stopped || !this.#transport.ready) return; // saved reply will be sent after reconnect.
      const reply=this.#store.get(row.event_id)!.reply!;
      // Keep the full answer locally. Do not silently truncate it or partially send a chunk series.
      const outgoing=reply.length<=4000?reply:'回复超过 QQ 原型的 4000 字符限制，正文已保存在本机，暂未发送。';
      const request=createOneBotReply(message,outgoing,row.event_id);
      this.#store.setState(row.event_id,'sending');
      try {
        const result=record(await this.#transport.request(request.action,request.params));
        if (!['string','number'].includes(typeof result.message_id)) throw new OneBotRequestError('Missing delivery receipt.',true);
        this.#store.setState(row.event_id,'sent'); this.#log('reply-confirmed');
      } catch (error) {
        const uncertain=!(error instanceof OneBotRequestError) || error.uncertain;
        this.#store.setState(row.event_id,uncertain?'uncertain':'ready');
        this.#log(uncertain?'delivery-needs-review':'waiting-for-connection');
        if (!uncertain) return;
      }
    }
  }
  async stop(): Promise<void> { this.#stopped=true; await this.#running; }
}
