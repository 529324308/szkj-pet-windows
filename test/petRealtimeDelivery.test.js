import assert from 'node:assert/strict';
import test from 'node:test';
import { createPetMessageDelivery } from '../src/pet/messageDelivery.js';
import { normalizeNormalRealtimeEvent } from '../src/composables/useEmployeeNormalChatRealtime.js';

const openedAt = Date.parse('2026-11-25T08:00:00.000Z');

function setup() {
  const messages = [];
  const delivery = createPetMessageDelivery({
    openedAt,
    userIds: new Set(['self']),
    show: message => messages.push(message),
  });
  return { delivery, messages };
}

test('桌宠与网页版使用同一套私聊字段，并按消息 ID 去掉重连重复', () => {
  const { delivery, messages } = setup();
  const event = normalizeNormalRealtimeEvent({
    Type: 'Message', Id: 'm1', BizId: 'c1', SenderId: 'peer', ReceiverId: 'self',
    SenderRealName: '张三', Message: '已收到附件', CreateTime: '2026-11-25T08:01:00.000Z',
  });
  delivery.chat(event);
  delivery.chat({ ...event });
  delivery.chat({ ...event, messageId: 'm2', userId: 'self' });
  delivery.chat({ ...event, messageId: 'm3', content: '', attachment: { id: 'a1' }, messageType: 'image' });
  assert.deepEqual(messages.map(item => [item.title, item.text, item.open.detail.conversationId]), [
    ['张三', '已收到附件', 'c1'],
    ['张三', '[图片]', 'c1'],
  ]);
});

test('真实公告只展示一次，历史快照、已读和信号不弹出', () => {
  const { delivery, messages } = setup();
  const fresh = { id: 'n1', createdAt: '2026-11-25T08:01:00.000Z', type: 'system_announcement', title: '会议通知' };
  delivery.notification({ ...fresh, id: 'history', createdAt: '2026-11-25T07:59:59.000Z' }, { snapshot: true });
  delivery.notification({ ...fresh, id: 'read', isRead: true });
  delivery.notification({ ...fresh, id: 'heartbeat', type: 'pong' });
  delivery.notification({ ...fresh, id: 'chat-copy', type: 'message' });
  delivery.notification(fresh, { snapshot: true });
  delivery.notification(fresh);
  assert.deepEqual(messages.map(item => [item.source, item.text, item.open.kind]), [
    ['announcement', '会议通知', 'notification-center'],
  ]);
});
