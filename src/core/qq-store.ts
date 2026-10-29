import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from '../channels/onebot.ts';

export type InboxRow = { event_id: string; conversation_id: string; payload: string; state: string; reply: string | null };
export type ConversationRow = { id: string; session_id: string; initialized: number; blocked: number };

/** Crash recovery is conservative: uncertain generation/delivery is never replayed. */
export class QqStore {
  #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS inbox(event_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, reply TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_pending ON inbox(state,created_at);
      UPDATE conversations SET blocked=1 WHERE id IN (SELECT conversation_id FROM inbox WHERE state='processing');
      UPDATE inbox SET state='uncertain' WHERE state IN ('processing','sending');`);
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
  setState(eventId: string, state: 'processing' | 'sending' | 'sent' | 'ready' | 'failed' | 'uncertain'): void {
    this.#db.prepare('UPDATE inbox SET state=?,updated_at=? WHERE event_id=?').run(state, Date.now(), eventId);
  }
  saveReply(eventId: string, reply: string): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare("UPDATE inbox SET state='ready',reply=?,updated_at=? WHERE event_id=?").run(reply, Date.now(), eventId);
      this.#db.prepare('UPDATE conversations SET initialized=1 WHERE id=(SELECT conversation_id FROM inbox WHERE event_id=?)').run(eventId);
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  block(conversationId: string): void { this.#db.prepare('UPDATE conversations SET blocked=1 WHERE id=?').run(conversationId); }
  close(): void { this.#db.close(); }
}
