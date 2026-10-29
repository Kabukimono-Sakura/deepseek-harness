import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from '../channels/onebot.ts';
import { relevance, planText } from './companion.ts';
import type { ReplyPlan, Bubble } from './companion.ts';

export type InboxRow = { event_id: string; conversation_id: string; payload: string; state: string; reply: string | null; created_at: number };
export type OutboxRow = { event_id: string; ordinal: number; payload: string; state: string };
export type ConversationRow = { id: string; session_id: string; initialized: number; blocked: number };

/** Crash recovery is conservative: uncertain generation/delivery is never replayed. */
export class QqStore {
  #db: DatabaseSync;
  constructor(path: string, options: { statelessGeneration?: boolean } = {}) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS inbox(event_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, reply TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_pending ON inbox(state,created_at);
      CREATE TABLE IF NOT EXISTS outbox(event_id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, receipt TEXT, PRIMARY KEY(event_id,ordinal));
      CREATE TABLE IF NOT EXISTS reflections(event_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wakeups(conversation_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS image_observations(event_id TEXT PRIMARY KEY, description TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profile_actions(event_id TEXT PRIMARY KEY, choice TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
      UPDATE conversations SET blocked=1 WHERE id IN (SELECT conversation_id FROM inbox WHERE state='processing');
      UPDATE inbox SET state='uncertain' WHERE state IN ('processing','sending');
      UPDATE outbox SET state='uncertain' WHERE state='sending';`);
    this.#db.exec("UPDATE profile_actions SET state='uncertain' WHERE state='sending'");
    if(options.statelessGeneration)this.#db.exec('UPDATE conversations SET blocked=0');
  }
  accept(message: IncomingMessage): 'accepted' | 'duplicate' | 'full' {
    if (this.#db.prepare('SELECT 1 FROM inbox WHERE event_id=?').get(message.eventId)) return 'duplicate';
    const count = this.#db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE state IN ('received','processing','ready','sending')").get()!.n as number;
    if (count >= 100) return 'full';
    const now = Date.now();
    this.#db.prepare('INSERT INTO inbox(event_id,conversation_id,payload,state,created_at,updated_at) VALUES(?,?,?,\'received\',?,?)')
      .run(message.eventId, message.conversationId, JSON.stringify(message), now, now);
    return 'accepted';
  }
  next(): InboxRow | undefined {
    return this.#db.prepare("SELECT * FROM inbox WHERE state IN ('received','ready') ORDER BY created_at,rowid LIMIT 1").get() as InboxRow | undefined;
  }
  get(eventId: string): InboxRow | undefined { return this.#db.prepare('SELECT * FROM inbox WHERE event_id=?').get(eventId) as InboxRow | undefined; }
  conversation(id: string): ConversationRow {
    this.#db.prepare('INSERT OR IGNORE INTO conversations(id,session_id) VALUES(?,?)').run(id, randomUUID());
    return this.#db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as ConversationRow;
  }
  setState(eventId: string, state: 'processing' | 'sending' | 'sent' | 'ready' | 'failed' | 'uncertain' | 'superseded' | 'skipped'): void {
    this.#db.prepare('UPDATE inbox SET state=?,updated_at=? WHERE event_id=?').run(state, Date.now(), eventId);
  }
  saveReply(eventId: string, reply: string): void {
    this.savePlan(eventId, {bubbles: [{text: reply}]});
  }
  savePlan(eventId: string, plan: ReplyPlan): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare("UPDATE inbox SET state='ready',reply=?,updated_at=? WHERE event_id=?").run(planText(plan), Date.now(), eventId);
      for (const [index, bubble] of plan.bubbles.entries()) {
        this.#db.prepare("INSERT INTO outbox(event_id,ordinal,payload,state) VALUES(?,?,?,'ready')").run(eventId,index,JSON.stringify(bubble));
      }
      if (plan.reflection) this.#db.prepare('INSERT OR REPLACE INTO reflections(event_id,conversation_id,text,created_at) SELECT event_id,conversation_id,?,? FROM inbox WHERE event_id=?').run(plan.reflection,Date.now(),eventId);
      this.#db.prepare('UPDATE conversations SET initialized=1 WHERE id=(SELECT conversation_id FROM inbox WHERE event_id=?)').run(eventId);
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  bubbles(eventId: string): OutboxRow[] {
    // Older persisted replies predate the outbox migration.
    const count=this.#db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE event_id=?').get(eventId)!.n;
    const row=this.get(eventId);
    if (!count && row?.reply) this.#db.prepare("INSERT INTO outbox VALUES(?,0,?,'ready',NULL)").run(eventId,JSON.stringify({text:row.reply}));
    return this.#db.prepare('SELECT * FROM outbox WHERE event_id=? ORDER BY ordinal').all(eventId) as OutboxRow[];
  }
  bubbleState(eventId: string, ordinal: number, state: string, receipt?: string): void {
    this.#db.prepare('UPDATE outbox SET state=?,receipt=? WHERE event_id=? AND ordinal=?').run(state,receipt??null,eventId,ordinal);
  }
  newerUserMessage(row: InboxRow): boolean {
    return Boolean(this.#db.prepare("SELECT 1 FROM inbox WHERE conversation_id=? AND state='received' AND event_id<>? AND json_extract(payload,'$.source') IS NOT 'proactive' LIMIT 1").get(row.conversation_id,row.event_id));
  }
  lastActivity(conversationId: string): number {
    return (this.#db.prepare('SELECT MAX(updated_at) AS t FROM inbox WHERE conversation_id=?').get(conversationId)?.t as number) || 0;
  }
  hasPending(conversationId: string): boolean {
    return Boolean(this.#db.prepare("SELECT 1 FROM inbox WHERE conversation_id=? AND state IN ('received','processing','ready','sending') LIMIT 1").get(conversationId));
  }
  wakeDue(conversationId: string, initial: number): number {
    this.#db.prepare('INSERT OR IGNORE INTO wakeups VALUES(?,?)').run(conversationId,initial);
    return this.#db.prepare('SELECT due_at FROM wakeups WHERE conversation_id=?').get(conversationId)!.due_at as number;
  }
  setWake(conversationId: string, due: number): void { this.#db.prepare('INSERT OR REPLACE INTO wakeups VALUES(?,?)').run(conversationId,due); }
  observeImages(eventId: string, description: string): void { this.#db.prepare('INSERT OR REPLACE INTO image_observations VALUES(?,?)').run(eventId,description); }
  avatarAction(eventId: string): {state: string} | undefined { return this.#db.prepare('SELECT state FROM profile_actions WHERE event_id=?').get(eventId) as {state: string}|undefined; }
  beginAvatar(eventId: string, choice: unknown): boolean { return this.#db.prepare("INSERT OR IGNORE INTO profile_actions VALUES(?,?,'sending',?)").run(eventId,JSON.stringify(choice),Date.now()).changes===1; }
  finishAvatar(eventId: string, state: string): void { this.#db.prepare('UPDATE profile_actions SET state=?,updated_at=? WHERE event_id=?').run(state,Date.now(),eventId); }
  memory(conversationId: string, query: string, excludeEvent?: string): string {
    const rows=this.#db.prepare("SELECT * FROM inbox WHERE conversation_id=? AND event_id<>? AND state NOT IN ('received','processing') ORDER BY created_at DESC,rowid DESC").all(conversationId,excludeEvent??'') as InboxRow[];
    const chosen=new Set(rows.slice(0,20));
    rows.slice(20).map(row=>({row,score:relevance(query,JSON.parse(row.payload).text+' '+(row.reply??''))}))
      .filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,12).forEach(item=>chosen.add(item.row));
    const history=[...chosen].sort((a,b)=>a.created_at-b.created_at).map(row=>{
      const msg=JSON.parse(row.payload) as IncomingMessage;
      const sent=this.#db.prepare("SELECT payload FROM outbox WHERE event_id=? AND state='sent' ORDER BY ordinal").all(row.event_id);
      const hasOutbox=this.#db.prepare('SELECT 1 FROM outbox WHERE event_id=? LIMIT 1').get(row.event_id);
      const delivered=sent.length ? sent.map(item=>{const b=JSON.parse(item.payload as string) as Bubble;return 'text' in b?b.text:`[表情:${b.stickerId}]`;}).join('\n') : row.state==='sent' && !hasOutbox ? row.reply : '';
      const observation=this.#db.prepare('SELECT description FROM image_observations WHERE event_id=?').get(row.event_id)?.description;
      const profileAction=this.#db.prepare('SELECT state,choice FROM profile_actions WHERE event_id=?').get(row.event_id);
      return {sourceId:row.event_id,time:new Date(row.created_at).toISOString(),source:msg.source??'user',incoming:msg.text,imageObservation:observation,profileAction,delivered:delivered||'',deliveryState:row.state};
    });
    const notes=this.#db.prepare('SELECT event_id AS sourceId,text,created_at FROM reflections WHERE conversation_id=? ORDER BY created_at DESC LIMIT 15').all(conversationId);
    // Bound the prompt, never the underlying archive. Each retained record remains valid JSON.
    while (JSON.stringify(history).length>32000 && history.length>1) history.shift();
    return JSON.stringify({history,selfObservations:notes});
  }
  block(conversationId: string): void { this.#db.prepare('UPDATE conversations SET blocked=1 WHERE id=?').run(conversationId); }
  close(): void { this.#db.close(); }
}
