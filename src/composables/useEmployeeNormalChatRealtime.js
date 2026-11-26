import { onBeforeUnmount, ref } from 'vue';
import { getValidAccessToken } from '../api/request.js';
import { exchangeEmployeeChatIdentity } from '../api/employeeChat.js';
import { resolveEmployeeChatWebSocketUrl } from '../api/employeeChatEndpoint.js';

// The normal/secure HTTP resources are namespaced below /chat/normal and
// /chat/secure, while realtime uses the shared Chat Backend socket.
export const EMPLOYEE_NORMAL_CHAT_WS_PATH = '/api/chat/websocket';
export const EMPLOYEE_NORMAL_CHAT_MAX_RECONNECT_ATTEMPTS = 3;
export const EMPLOYEE_NORMAL_CHAT_ACK_TIMEOUT_MS = 8000;

export function normalizeNormalRealtimeEvent(input) {
	let payload = input;
	if (typeof payload === 'string') {
		try { payload = JSON.parse(payload); } catch { return null; }
	}
	if (!payload || typeof payload !== 'object') return null;
	const type = String(payload.type ?? payload.event ?? payload.Type ?? '').trim().toLowerCase();
	if (!type) return null;
	const normalized = {
		...payload,
		type,
		conversationId: String(payload.conversationId ?? payload.conversationID ?? payload.ConversationId ?? payload.BizId ?? payload.SenderId ?? payload.ReceiverId ?? '').trim(),
		messageId: String(payload.messageId ?? payload.id ?? payload.Id ?? payload.MessageId ?? '').trim(),
		clientMessageId: String(payload.clientMessageId ?? payload.ClientMessageId ?? payload.clientId ?? '').trim(),
		userId: String(payload.userId ?? payload.UserId ?? payload.senderId ?? payload.SenderId ?? '').trim(),
		receiverId: String(payload.receiverId ?? payload.ReceiverId ?? '').trim(),
		content: String(payload.content ?? payload.text ?? payload.message ?? payload.Message ?? '').trim(),
		online: (payload.online ?? payload.Online) === true,
		status: String(payload.status ?? payload.Status ?? '').trim().toLowerCase(),
		readAt: payload.readAt ?? payload.ReadAt ?? '',
		deliveredAt: payload.deliveredAt ?? payload.DeliveredAt ?? '',
	};
	const rawMessageType = payload.messageType ?? payload.MessageType;
	const rawAttachment = payload.attachment ?? payload.Attachment;
	const rawLocation = payload.location ?? payload.Location;
	if (rawMessageType !== undefined) normalized.messageType = String(rawMessageType || 'text').trim().toLowerCase() || 'text';
	const businessNotification = payload.businessNotification ?? payload.BusinessNotification;
	if (businessNotification !== undefined) normalized.businessNotification = businessNotification;
	if (rawAttachment !== undefined) normalized.attachment = rawAttachment;
	if (rawLocation !== undefined) normalized.location = rawLocation;
	const onlineUserIds = payload.onlineUserIds ?? payload.OnlineUserIds;
	if (Array.isArray(onlineUserIds)) normalized.onlineUserIds = onlineUserIds.map(value => String(value || '').trim()).filter(Boolean);
	const presenceItems = payload.presenceItems ?? payload.PresenceItems;
	if (Array.isArray(presenceItems)) normalized.presenceItems = presenceItems.map(item => ({
		userId: String(item?.userId ?? item?.UserId ?? '').trim(),
		online: (item?.online ?? item?.Online) === true,
		lastSeenAt: item?.lastSeenAt ?? item?.LastSeenAt ?? '',
	})).filter(item => item.userId);
	normalized.lastSeenAt = payload.lastSeenAt ?? payload.LastSeenAt ?? '';
	const senderName = String(payload.senderName ?? payload.SenderRealName ?? payload.SenderName ?? '').trim();
	const createdAt = payload.createdAt ?? payload.CreateTime ?? '';
	if (senderName) normalized.senderName = senderName;
	if (createdAt) normalized.createdAt = createdAt;
	return normalized;
}

// 服务端 403 的 code 是唯一稳定的判据：message 面向运维，不能直接念给用户。
const CHAT_ACCESS_NOTICES = {
	CHAT_ACCOUNT_DISABLED: '当前账号未开通员工聊天，请联系管理员。',
	CHAT_ACCOUNT_POLICY_MISSING: '当前账号尚未配置聊天范围，请联系管理员。',
	CHAT_TEMP_ACCOUNT_EXPIRED: '临时账号已到期，不能使用员工聊天。',
	CHAT_RECIPIENT_DISABLED: '对方账号未开通员工聊天。',
	AUTH_TEMP_ACCOUNT_EXPIRED: '临时账号已到期，不能使用员工聊天。',
	AUTH_ACCOUNT_INACTIVE: '当前账号已停用，不能使用员工聊天。',
};

export function resolveChatAccessNotice(error = {}) {
	const code = String(error?.data?.error?.code || error?.data?.code || error?.code || '').trim();
	if (CHAT_ACCESS_NOTICES[code]) return CHAT_ACCESS_NOTICES[code];
	const fallback = String(error?.data?.error?.message || error?.data?.message || error?.message || '').trim();
	return fallback || '当前账号未开通员工聊天，请联系管理员。';
}

export function useEmployeeNormalChatRealtime({ onMessage, onAck, onDelivered, onRead, onPresence, onMutation, onFailed, onConnected, trackVisibility = true } = {}) {
	const status = ref('idle');
	// 403 拒绝原因：面板据此显示明确空态，而不是"网络异常"或沉默重试。
	const accessNotice = ref('');
	let socket = null;
	let reconnectTimer = null;
	let reconnectAttempt = 0;
	let manualClose = false;
	let connectionGeneration = 0;
	let terminalFailure = false;
	let heartbeatTimer = null;
	let hasConnected = false;
	const pendingMessages = new Map();
	let visibilityListener = null;
	let pageHideListener = null;

	function isDocumentVisible() {
		return typeof document === 'undefined' || document.visibilityState !== 'hidden';
	}
	function sendVisibilityState(visible = isDocumentVisible()) {
		if (socket?.readyState !== window.WebSocket.OPEN) return false;
		try {
			socket.send(JSON.stringify({ Type: 'Visibility', Visible: visible }));
			return true;
		} catch {
			return false;
		}
	}
	function installVisibilityListeners() {
		if (typeof document === 'undefined' || visibilityListener) return;
		visibilityListener = () => sendVisibilityState();
		pageHideListener = () => sendVisibilityState();
		document.addEventListener('visibilitychange', visibilityListener);
		window.addEventListener?.('pagehide', pageHideListener);
	}
	function removeVisibilityListeners() {
		if (typeof document !== 'undefined' && visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
		if (typeof window !== 'undefined' && pageHideListener) window.removeEventListener?.('pagehide', pageHideListener);
		visibilityListener = null;
		pageHideListener = null;
	}

	function clearReconnect() {
		if (reconnectTimer) window.clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	function clearHeartbeat() {
		if (heartbeatTimer) window.clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	function clearPendingTimer(entry) {
		if (!entry?.timer) return;
		window.clearTimeout(entry.timer);
		entry.timer = null;
	}
	function wirePayload(payload = {}, clientMessageId = '') {
		return {
			Type: 'Message',
			ReceiverId: payload.ReceiverId ?? payload.receiverId ?? '',
			ReceiverName: payload.ReceiverName ?? payload.receiverName ?? '',
			Message: payload.Message ?? payload.message ?? '',
			ClientMessageId: clientMessageId || (payload.ClientMessageId ?? payload.clientMessageId ?? ''),
		};
	}
	function sendPending(entry) {
		if (!entry || !pendingMessages.has(entry.clientMessageId)) return false;
		if (!socket || socket.readyState !== window.WebSocket.OPEN) return false;
		clearPendingTimer(entry);
		try {
			socket.send(JSON.stringify(wirePayload(entry.payload, entry.clientMessageId)));
			entry.attempts += 1;
			entry.timer = window.setTimeout(() => {
				if (!pendingMessages.has(entry.clientMessageId)) return;
				if (!socket || socket.readyState !== window.WebSocket.OPEN) {
					entry.timer = window.setTimeout(() => sendPending(entry), 1000);
					return;
				}
				if (entry.attempts >= EMPLOYEE_NORMAL_CHAT_MAX_RECONNECT_ATTEMPTS + 1) {
					pendingMessages.delete(entry.clientMessageId);
					onFailed?.({ type: 'send.failed', clientMessageId: entry.clientMessageId, message: entry.payload.Message ?? entry.payload.message ?? '', error: '消息发送超时，请重试。' });
					return;
				}
				sendPending(entry);
			}, EMPLOYEE_NORMAL_CHAT_ACK_TIMEOUT_MS);
			return true;
		} catch {
			return false;
		}
	}
	function flushPending() {
		for (const entry of pendingMessages.values()) sendPending(entry);
	}
	function startHeartbeat() {
		clearHeartbeat();
		heartbeatTimer = window.setInterval(() => {
			if (socket?.readyState === window.WebSocket.OPEN) socket.send(JSON.stringify({ Type: 'Ping' }));
		}, 25000);
	}
	function scheduleReconnect() {
		if (manualClose || terminalFailure || reconnectTimer) return;
		status.value = 'reconnecting';
		const delay = Math.min(30000, 500 * (2 ** Math.min(reconnectAttempt, 6)));
		reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect().catch(() => {}); }, delay);
		reconnectAttempt += 1;
	}
	function handleMessage(event) {
		const payload = normalizeNormalRealtimeEvent(event?.data);
		if (!payload) return;
		if (['ack', 'message.ack', 'sent'].includes(payload.type)) {
			const clientMessageId = payload.clientMessageId;
			const pending = clientMessageId ? pendingMessages.get(clientMessageId) : null;
			if (pending) {
				clearPendingTimer(pending);
				pendingMessages.delete(clientMessageId);
			}
			onAck?.(payload);
		}
		else if (['delivered', 'message.delivered', 'delivery'].includes(payload.type)) onDelivered?.(payload);
		else if (['read', 'message.read', 'message.readed'].includes(payload.type)) onRead?.(payload);
		else if (['message', 'message.created', 'new_message'].includes(payload.type)) onMessage?.(payload);
		else if (['message.recalled', 'message.deleted'].includes(payload.type)) onMutation?.(payload);
		else if (['presence', 'presence.changed', 'presence.snapshot', 'presencesnapshot', 'online', 'offline'].includes(payload.type)) onPresence?.(payload);
	}
	async function connect() {
		if (typeof window === 'undefined' || !window.WebSocket) return false;
		if (socket && [window.WebSocket.OPEN, window.WebSocket.CONNECTING].includes(socket.readyState)) return true;
		const generation = ++connectionGeneration;
		manualClose = false;
		terminalFailure = false;
		status.value = 'connecting';
		let accessToken = '';
		try {
			accessToken = await getValidAccessToken();
		} catch (error) {
			if (generation !== connectionGeneration) return false;
			const httpStatus = Number(error?.status || 0);
			status.value = httpStatus === 401 || httpStatus === 403 ? 'unauthorized' : 'unavailable';
			if (httpStatus === 401 || httpStatus === 403) accessNotice.value = '登录状态已失效，请重新登录。';
			terminalFailure = true;
			return false;
		}
		if (generation !== connectionGeneration) return false;
		if (!accessToken) { accessNotice.value = '登录状态已失效，请重新登录。'; status.value = 'unauthorized'; terminalFailure = true; return false; }
		let chatToken = accessToken;
		try {
			const exchanged = await exchangeEmployeeChatIdentity({});
			const candidate = exchanged?.accessToken || exchanged?.token || exchanged?.chatToken || exchanged?.data?.accessToken || exchanged?.data?.token || exchanged?.data?.chatToken;
			if (candidate) chatToken = String(candidate);
		} catch (error) {
			if (generation !== connectionGeneration) return false;
			// 403/401 是策略结论（未开通聊天、范围未配置、临时账号到期），不是
			// 网络抖动：继续用业务 token 连 socket 只会被服务端 1008 关闭，然后
			// 触发无限重连 + 每轮再打一次会话列表，形成满屏 403。这里直接终止。
			const httpStatus = Number(error?.status || 0);
			if (httpStatus === 401 || httpStatus === 403) {
				accessNotice.value = resolveChatAccessNotice(error);
				status.value = 'unauthorized';
				terminalFailure = true;
				return false;
			}
			// Keep compatibility with a test backend that has not deployed the
			// exchange endpoint yet; the server still accepts the business token.
		}
		if (generation !== connectionGeneration) return false;
		let current;
		try {
			const url = new URL(resolveEmployeeChatWebSocketUrl(EMPLOYEE_NORMAL_CHAT_WS_PATH));
			url.searchParams.set('token', chatToken);
			current = new window.WebSocket(url.toString());
		} catch {
			status.value = 'unavailable';
			terminalFailure = true;
			return false;
		}
		socket = current;
		current.onopen = () => {
			if (socket !== current) return;
			const reconnected = hasConnected;
			hasConnected = true;
			reconnectAttempt = 0;
			accessNotice.value = '';
			status.value = 'connected';
			startHeartbeat();
			if (trackVisibility) {
				installVisibilityListeners();
				sendVisibilityState();
			} else {
				sendVisibilityState(false);
			}
			flushPending();
			onConnected?.({ reconnected });
		};
		current.onmessage = (event) => {
			if (socket === current) handleMessage(event);
		};
		current.onerror = () => {
			if (socket === current) status.value = 'error';
		};
		current.onclose = (event) => {
			if (socket !== current) return;
			clearHeartbeat();
			socket = null;
			// 1008 = 服务端策略关闭（未开通聊天/临时账号到期）。这类关闭重连必然
			// 再次失败，必须终止重试，否则每个面板打开都是一串 403/1008。
			if ([1008, 4401, 4403].includes(Number(event?.code || 0))) {
				terminalFailure = true;
				status.value = 'unauthorized';
				if (!accessNotice.value) accessNotice.value = String(event?.reason || '').trim() || '当前账号未开通员工聊天，请联系管理员。';
				return;
			}
			if (!manualClose && !terminalFailure) { status.value = 'disconnected'; scheduleReconnect(); }
		};
		return true;
	}
	function sendMessage(payload = {}) {
		const clientMessageId = String(payload.ClientMessageId ?? payload.clientMessageId ?? '').trim();
		if (!clientMessageId) return false;
		if (!pendingMessages.has(clientMessageId)) pendingMessages.set(clientMessageId, { payload, clientMessageId, attempts: 0, timer: null });
		const entry = pendingMessages.get(clientMessageId);
		if (socket?.readyState === window.WebSocket.OPEN) return sendPending(entry);
		return true;
	}
	function close() {
		connectionGeneration += 1;
		manualClose = true;
		terminalFailure = false;
		hasConnected = false;
		clearReconnect();
		clearHeartbeat();
		if (socket) socket.close();
		socket = null;
		removeVisibilityListeners();
		for (const entry of pendingMessages.values()) clearPendingTimer(entry);
		status.value = 'idle';
	}
	onBeforeUnmount(close);
	return { status, accessNotice, connect, close, sendMessage };
}
