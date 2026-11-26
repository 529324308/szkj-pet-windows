// 桌宠气泡消息总线。
// 各消息来源（个人中心通知、员工聊天、AI 回复）只负责推送一条结构化消息，
// 桌宠挂件自己决定怎么展示、什么时候收起，避免消息来源耦合挂件实现。
//
// 消息形状：
//   { source: 'notification' | 'announcement' | 'chat' | 'ai', label, title, text, open }
// open 是点击气泡时的动作描述，由挂件解释：
//   { kind: 'notification-center' } 打开消息中心
//   { kind: 'employee-chat', detail } 打开员工聊天会话
export const PET_MESSAGE_EVENT = 'szkj:pet-message';

const MAX_TEXT_LENGTH = 120;

function clip(value, max = MAX_TEXT_LENGTH) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 推一条气泡消息；挂件未显示时事件自然无人接收，不影响业务。 */
export function pushPetMessage(message = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const source = String(message.source || 'notification').trim() || 'notification';
  const text = clip(message.text);
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent(PET_MESSAGE_EVENT, {
      detail: {
        source,
        label: clip(message.label, 12) || labelForSource(source),
        title: clip(message.title, 24),
        text,
        open: message.open && typeof message.open === 'object' ? message.open : null,
        at: Date.now(),
      },
    }),
  );
}

export function labelForSource(source) {
  switch (source) {
    case 'announcement':
      return '系统公告';
    case 'chat':
      return '员工消息';
    case 'ai':
      return 'AI 回复';
    default:
      return '平台通知';
  }
}
