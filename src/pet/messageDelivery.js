function remember(seen, key) {
  if (!key || seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  return true;
}

// The normal-chat composable already separates message events from protocol frames.
export function createPetMessageDelivery({ userIds, openedAt, show }) {
  const seenChat = new Set();
  const seenNotifications = new Set();

  return {
    chat(event) {
      const { userId, receiverId, messageId, conversationId, content, attachment, location, messageType, createdAt } = event;
      if (!userId || userIds.has(userId) || userId === receiverId || (!content && !attachment && !location)) return;
      const id = messageId || (createdAt && JSON.stringify([userId, conversationId, createdAt, content]));
      if (!remember(seenChat, id)) return;
      const senderName = event.senderName || event.userName || '员工';
      const text = content || (location ? '[位置]' : messageType === 'image' ? '[图片]' : '[文件]');
      show({
        source: 'chat',
        title: senderName,
        text,
        open: { kind: 'employee-chat', detail: { messageId, conversationId, contactId: userId, senderName, content: text, createdAt } },
      });
    },
    notification(item, { snapshot = false } = {}) {
      const key = item.id || item.__key;
      if (!remember(seenNotifications, key)) return;
      const time = Date.parse(item.createdAt);
      if (item.isRead || (Number.isFinite(time) ? time < openedAt : snapshot)) return;
      const type = String(item.type || '').toLowerCase();
      if (['message', 'chat', 'employee_chat', 'ping', 'pong'].includes(type)) return;
      show({
        source: type.includes('announcement') ? 'announcement' : 'notification',
        title: item.title || item.senderName,
        text: item.content || item.title,
        open: { kind: 'notification-center' },
      });
    },
  };
}
