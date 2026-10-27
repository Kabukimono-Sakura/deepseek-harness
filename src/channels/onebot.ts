// Wire protocol references are recorded in docs/wiki/Architecture.md.
// No network calls or model calls belong in this parser.
export interface OneBotPolicy {
  allowedUsers: readonly string[];
  allowedGroups: readonly string[];
  requireMention: boolean;
}

export interface IncomingMessage {
  channel: 'qq-onebot';
  accountId: string;
  conversationId: string;
  senderId: string;
  eventId: string;
  text: string;
  replyTarget: { kind: 'private' | 'group'; id: string };
}

type ParseResult =
  | { accepted: true; message: IncomingMessage }
  | { accepted: false; reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown, signed = false): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  if (!(signed ? /^-?(0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(text)) return null;
  return text;
}

export function parseOneBotMessage(input: unknown, policy: OneBotPolicy): ParseResult {
  const reject = (reason: string): ParseResult => ({ accepted: false, reason });
  if (!record(input) || input.post_type !== 'message') return reject('not-message');
  const kind = input.message_type;
  if (kind !== 'private' && kind !== 'group') return reject('unsupported-conversation');
  const accountId = id(input.self_id);
  const senderId = id(input.user_id);
  const messageId = id(input.message_id, true);
  const targetId = kind === 'group' ? id(input.group_id) : senderId;
  if (!accountId || !senderId || messageId === null || !targetId) return reject('invalid-id');
  if (senderId === accountId) return reject('self-message');
  if (!policy.allowedUsers.includes(senderId)) return reject('sender-not-allowed');
  if (kind === 'group' && !policy.allowedGroups.includes(targetId)) return reject('group-not-allowed');
  if (kind === 'private' && input.sub_type !== 'friend') return reject('unsupported-private-subtype');
  if (kind === 'group' && (input.sub_type !== 'normal' || input.anonymous != null)) {
    return reject('unsupported-group-subtype');
  }
  if (!Array.isArray(input.message)) return reject('array-message-required');
  if (input.message.length > 128) return reject('too-many-segments');
  let mentioned = false;
  let text = '';
  for (const segment of input.message) {
    if (!record(segment) || !record(segment.data)) return reject('invalid-segment');
    if (segment.type === 'text') {
      if (typeof segment.data.text !== 'string') return reject('invalid-text');
      text += segment.data.text;
      if (text.length > 16_000) return reject('text-too-long');
    } else if (segment.type === 'at') {
      if (id(segment.data.qq) === accountId) mentioned = true;
    } else {
      // Reject rather than silently discard an image, reply quote or other context.
      return reject('unsupported-segment');
    }
  }
  if (kind === 'group' && policy.requireMention && !mentioned) return reject('mention-required');
  text = text.trim();
  if (!text) return reject('empty-text');
  const conversationId = JSON.stringify(['qq-onebot', accountId, kind, targetId]);
  return {
    accepted: true,
    message: {
      channel: 'qq-onebot', accountId, senderId, conversationId,
      eventId: JSON.stringify([conversationId, messageId]),
      text, replyTarget: { kind, id: targetId },
    },
  };
}

export function createOneBotReply(message: IncomingMessage, text: string, echo: string) {
  if (!text.trim() || text.length > 4000) throw new Error('Reply must contain 1–4000 characters');
  if (!echo) throw new Error('A request correlation ID is required');
  const target = message.replyTarget;
  return {
    action: target.kind === 'group' ? 'send_group_msg' : 'send_private_msg',
    params: {
      [target.kind === 'group' ? 'group_id' : 'user_id']: target.id,
      // Structured text prevents generated CQ strings being interpreted as actions.
      message: [{ type: 'text', data: { text } }],
    },
    echo,
  };
}
