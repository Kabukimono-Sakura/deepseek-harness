import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOneBotMessage, createOneBotReply } from '../src/channels/onebot.ts';

const policy = { allowedUsers: ['10002'], allowedGroups: ['30001'], requireMention: true };
const privateEvent = {
  post_type: 'message', message_type: 'private', sub_type: 'friend',
  self_id: 10001, user_id: 10002, message_id: -42,
  message: [{ type: 'text', data: { text: '你好' } }],
};
const groupEvent = {
  ...privateEvent, message_type: 'group', sub_type: 'normal', group_id: 30001,
  message: [{ type: 'at', data: { qq: '10001' } }, ...privateEvent.message],
};

test('private/group/bot identities produce separate conversation and dedup keys', () => {
  const events = [privateEvent, groupEvent, { ...privateEvent, self_id: 10003 }];
  const parsed = events.map(e => parseOneBotMessage(e, policy));
  assert.ok(parsed.every(p => p.accepted));
  assert.equal(new Set(parsed.map(p => p.message.conversationId)).size, 3);
  assert.equal(new Set(parsed.map(p => p.message.eventId)).size, 3);
  assert.equal(parsed[0].message.eventId, parseOneBotMessage(privateEvent, policy).message.eventId);
});

test('empty allowlists and unknown users/groups reject messages', () => {
  assert.equal(parseOneBotMessage(privateEvent, { ...policy, allowedUsers: [] }).accepted, false);
  assert.equal(parseOneBotMessage({ ...groupEvent, user_id: 999 }, policy).accepted, false);
  assert.equal(parseOneBotMessage({ ...groupEvent, group_id: 999 }, policy).accepted, false);
});

test('group replies require a structured mention of this account', () => {
  assert.equal(parseOneBotMessage(groupEvent, policy).accepted, true);
  for (const message of [privateEvent.message, [{ type: 'at', data: { qq: 'all' } }, ...privateEvent.message]]) {
    assert.equal(parseOneBotMessage({ ...groupEvent, message }, policy).reason, 'mention-required');
  }
});

test('ignore self, non-message, temporary and anonymous conversations', () => {
  for (const event of [
    { ...privateEvent, user_id: 10001 }, { post_type: 'meta_event' },
    { ...privateEvent, sub_type: 'group' }, { ...groupEvent, anonymous: { id: 1 } },
  ]) assert.equal(parseOneBotMessage(event, policy).accepted, false);
});

test('reject malformed IDs, unsupported media, CQ strings and oversized input', () => {
  for (const event of [
    null, [], { ...privateEvent, self_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...privateEvent, message_id: null }, { ...privateEvent, user_id: '010002' },
    { ...privateEvent, message: '[CQ:at,qq=10001]hello' },
    { ...privateEvent, message: [{ type: 'image', data: { file: 'x' } }] },
    { ...privateEvent, message: [{ type: 'text', data: { text: 123 } }] },
    { ...privateEvent, message: [{ type: 'text', data: { text: 'x'.repeat(16001) } }] },
  ]) assert.equal(parseOneBotMessage(event, policy).accepted, false);
});

test('reply stays bound to original target and preserves generated CQ markup as text', () => {
  for (const [event, action, field, target] of [
    [privateEvent, 'send_private_msg', 'user_id', '10002'],
    [groupEvent, 'send_group_msg', 'group_id', '30001'],
  ]) {
    const parsed = parseOneBotMessage(event, policy);
    const reply = createOneBotReply(parsed.message, '[CQ:at,qq=all]', 'request-1');
    assert.equal(reply.action, action);
    assert.equal(reply.params[field], target);
    assert.deepEqual(reply.params.message, [{ type: 'text', data: { text: '[CQ:at,qq=all]' } }]);
    assert.equal(reply.echo, 'request-1');
    assert.throws(() => createOneBotReply(parsed.message, 'x'.repeat(4001), 'request-2'));
  }
});
