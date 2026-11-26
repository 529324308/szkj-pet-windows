import { computed, readonly, ref } from 'vue';
import { resolveBusinessUrl } from '../api/request.js';
import { getNotifications, getRealtimeToken, markNotificationRead } from '../api/personalCenter.js';
import { isOtherDeviceLoginAlertMessage } from '../utils/securityAlert.js';

const PERSONAL_CENTER_WS_PATH = '/ws/PersonalCenter';
const LAST_EVENT_ID_STORAGE_KEY = 'szkj:personal-center:last-event-id';
const MAX_EVENT_COUNT = 50;
const MAX_NOTIFICATION_COUNT = 50;
const MAX_RECENT_EVENT_IDS = 300;
const MAX_RECONNECT_DELAY_MS = 30 * 1000;
const HIDDEN_NOTIFICATION_TYPES = new Set(['online', 'offline', 'online_reminder', 'offline_reminder']);

const connectionStatus = ref('idle');
const envelopeList = ref([]);
const notificationList = ref([]);
const lastEnvelope = ref(null);
const lastRefreshSignal = ref(null);
const unreadNotificationCount = ref(0);
const securityMessageListeners = new Set();
const notificationListeners = new Set();

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let manualClose = false;
let connectPromise = null;
let connectionGeneration = 0;
const recentEventIds = [];

// Some backends (e.g. the current test site) have not deployed
// /api/PersonalCenter/realtime/token yet and answer 404. Remember that for a
// while so a refresh or reconnect does not keep issuing a doomed request and
// painting the console red; loadPersonalCenterNotifications() still supplies
// the notification snapshot over plain HTTP.
const REALTIME_UNSUPPORTED_KEY = 'szkj:personal-center:realtime-unsupported-until';
const REALTIME_UNSUPPORTED_TTL_MS = 6 * 60 * 60 * 1000;

function isRealtimeEndpointUnsupported() {
	try {
		const until = Number(localStorage.getItem(REALTIME_UNSUPPORTED_KEY) || 0);
		if (until > Date.now()) return true;
		if (until) localStorage.removeItem(REALTIME_UNSUPPORTED_KEY);
	} catch {
		// Storage blocked: fall back to trying the endpoint once per page load.
	}
	return false;
}

function markRealtimeEndpointUnsupported() {
	try {
		localStorage.setItem(REALTIME_UNSUPPORTED_KEY, String(Date.now() + REALTIME_UNSUPPORTED_TTL_MS));
	} catch {
		// Ignore storage failures.
	}
}

const reportReminders = computed(() => (
	notificationList.value
		.filter((item) => item.type === 'report_submit_reminder')
		.slice()
		.sort((a, b) => getNotificationTime(b) - getNotificationTime(a))
));

const unreadReportReminders = computed(() => reportReminders.value.filter((item) => !item.isRead));
const latestReportReminder = computed(() => reportReminders.value[0] || null);
const isPersonalCenterRealtimeConnected = computed(() => connectionStatus.value === 'connected');

function safeString(value, fallback = '') {
	if (value === null || value === undefined) return fallback;
	return String(value);
}

function pickValue(source, keys, fallback = undefined) {
	for (const key of keys) {
		if (source && source[key] !== undefined && source[key] !== null) {
			return source[key];
		}
	}
	return fallback;
}

function normalizeBoolean(value) {
	if (value === true || value === false) return value;
	if (value === 'true') return true;
	if (value === 'false') return false;
	return false;
}

function getNotificationTime(notification) {
	const parsed = Date.parse(notification?.createdAt || '');
	return Number.isFinite(parsed) ? parsed : Number(notification?.__receivedAt || 0);
}

export function isHiddenPersonalCenterNotification(notification = {}) {
	const type = safeString(notification?.type || notification?.Type).trim().toLowerCase();
	if (HIDDEN_NOTIFICATION_TYPES.has(type)) return true;
	// Private employee chat messages belong to the employee chat surface, not
	// the notification center.  In particular, a self-directed message must
	// never be promoted to a system-message popup.
	if (type === 'message' && !isOtherDeviceLoginAlertMessage(notification)
		&& (notification?.SenderId || notification?.senderId || notification?.ReceiverId || notification?.receiverId)) return true;
	const title = safeString(notification?.title || notification?.Title).trim();
	return title === '上线提醒' || title === '离线提醒';
}

function refreshUnreadNotificationCount() {
	unreadNotificationCount.value = notificationList.value.filter((item) => !item.isRead).length;
}

function buildNotificationKey(notification = {}) {
	return safeString(
		notification.id
		|| notification.notificationId
		|| [
			notification.type,
			notification.bizId,
			notification.bizDataId,
			notification.createdAt,
			notification.content,
		].filter(Boolean).join(':')
		|| `notification-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	);
}

function normalizeNotification(source = {}) {
	const payload = pickValue(source, ['payload', 'Payload'], null);
	const normalized = {
		id: safeString(pickValue(source, ['id', 'Id', 'notificationId', 'NotificationId']), ''),
		title: safeString(pickValue(source, ['title', 'Title']), ''),
		content: safeString(pickValue(source, ['content', 'Content', 'message', 'Message']), ''),
		type: safeString(pickValue(source, ['type', 'Type', 'eventType', 'EventType']), ''),
		category: safeString(pickValue(source, ['category', 'Category']), ''),
		priority: safeString(pickValue(source, ['priority', 'Priority']), ''),
		bizType: safeString(pickValue(source, ['bizType', 'BizType']), ''),
		bizId: safeString(pickValue(source, ['bizId', 'BizId']), ''),
		bizDataId: safeString(pickValue(source, ['bizDataId', 'BizDataId']), ''),
		relatedType: safeString(pickValue(source, ['relatedType', 'RelatedType']), ''),
		relatedId: safeString(pickValue(source, ['relatedId', 'RelatedId']), ''),
		vehicleId: safeString(pickValue(source, ['vehicleId', 'VehicleId'], payload?.vehicleId || payload?.VehicleId || ''), ''),
		payload,
		route: safeString(pickValue(source, ['route', 'Route']), ''),
		routeParams: pickValue(source, ['routeParams', 'RouteParams'], null),
		actionText: safeString(pickValue(source, ['actionText', 'ActionText']), ''),
		isRead: normalizeBoolean(pickValue(source, ['isRead', 'IsRead'], false)),
		readAt: safeString(pickValue(source, ['readAt', 'ReadAt']), ''),
		createdAt: safeString(pickValue(source, ['createdAt', 'CreatedAt', 'occurredAt', 'OccurredAt']), ''),
		senderName: safeString(pickValue(source, ['senderName', 'SenderName', 'title', 'Title']), ''),
		senderRealName: safeString(pickValue(source, ['senderRealName', 'SenderRealName']), ''),
		__source: 'personal-center-notification',
		__receivedAt: Date.now(),
	};

	normalized.Id = normalized.id;
	normalized.Title = normalized.title;
	normalized.Message = normalized.content;
	normalized.Type = normalized.type;
	normalized.BizType = normalized.bizType;
	normalized.BizId = normalized.bizId;
	normalized.RelatedType = normalized.relatedType;
	normalized.RelatedId = normalized.relatedId;
	normalized.IsRead = normalized.isRead;
	normalized.ReadAt = normalized.readAt;
	normalized.CreateTime = normalized.createdAt;
	normalized.SenderName = normalized.senderName;
	normalized.SenderRealName = normalized.senderRealName;
	normalized.__key = buildNotificationKey(normalized);
	return normalized;
}

function normalizeRefreshHint(source = {}) {
	return {
		target: safeString(pickValue(source, ['target', 'Target']), ''),
		bizId: safeString(pickValue(source, ['bizId', 'BizId']), ''),
		reason: safeString(pickValue(source, ['reason', 'Reason']), ''),
	};
}

function normalizeEnvelope(source = {}) {
	const refreshHintsRaw = pickValue(source, ['refreshHints', 'RefreshHints'], []);
	return {
		eventId: safeString(pickValue(source, ['eventId', 'EventId']), ''),
		eventType: safeString(pickValue(source, ['eventType', 'EventType', 'type', 'Type']), ''),
		occurredAt: safeString(pickValue(source, ['occurredAt', 'OccurredAt', 'createdAt', 'CreatedAt']), ''),
		notificationId: safeString(pickValue(source, ['notificationId', 'NotificationId']), ''),
		unreadCount: Number(pickValue(source, ['unreadCount', 'UnreadCount'], unreadNotificationCount.value) ?? unreadNotificationCount.value),
		needRefresh: Boolean(pickValue(source, ['needRefresh', 'NeedRefresh'], false)),
		refreshHints: Array.isArray(refreshHintsRaw) ? refreshHintsRaw.map((item) => normalizeRefreshHint(item)).filter((item) => item.target) : [],
		notification: pickValue(source, ['notification', 'Notification'], null),
		payload: pickValue(source, ['payload', 'Payload'], null),
		__receivedAt: Date.now(),
	};
}

export function onPersonalCenterSecurityMessage(listener) {
	if (typeof listener !== 'function') return () => {};
	securityMessageListeners.add(listener);
	return () => securityMessageListeners.delete(listener);
}

export function onPersonalCenterNotification(listener) {
	notificationListeners.add(listener);
	return () => notificationListeners.delete(listener);
}

function rememberEventId(eventId) {
	if (!eventId || recentEventIds.includes(eventId)) return false;
	recentEventIds.push(eventId);
	if (recentEventIds.length > MAX_RECENT_EVENT_IDS) {
		recentEventIds.splice(0, recentEventIds.length - MAX_RECENT_EVENT_IDS);
	}
	try {
		localStorage.setItem(LAST_EVENT_ID_STORAGE_KEY, eventId);
	} catch {
		// Ignore storage failures.
	}
	return true;
}

function readLastEventId() {
	try {
		return localStorage.getItem(LAST_EVENT_ID_STORAGE_KEY) || '';
	} catch {
		return '';
	}
}

function clearReconnectTimer() {
	if (!reconnectTimer) return;
	window.clearTimeout(reconnectTimer);
	reconnectTimer = null;
}

function resolveReconnectDelay() {
	const delay = Math.min(1000 * (2 ** reconnectAttempt), MAX_RECONNECT_DELAY_MS);
	const jitter = Math.floor(Math.random() * 500);
	return delay + jitter;
}

function hasAuthSession() {
	try {
		return Boolean(localStorage.getItem('refreshToken') || localStorage.getItem('accessToken'));
	} catch {
		return false;
	}
}

function buildSocketUrl(wsUrl, wsToken, lastEventId) {
	const fallbackUrl = resolveBusinessUrl(PERSONAL_CENTER_WS_PATH);
	const url = new URL(wsUrl || fallbackUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
	url.searchParams.set('token', wsToken);
	if (lastEventId) {
		url.searchParams.set('lastEventId', lastEventId);
	}
	return url.toString();
}

function upsertNotification(notificationSource) {
	const nextNotification = normalizeNotification(notificationSource);
	if (isHiddenPersonalCenterNotification(nextNotification)) return null;
	const nextList = notificationList.value.slice();
	const existingIndex = nextList.findIndex((item) => item.__key === nextNotification.__key);

	if (existingIndex >= 0) {
		const existing = nextList[existingIndex];
		// 重连/补发可能携带旧的 IsRead=false。客户端已经确认过的通知
		// 不能被旧快照覆盖回未读，否则会再次进入提醒角标和弹窗链路。
		if (existing.isRead && !nextNotification.isRead) {
			nextNotification.isRead = true;
			nextNotification.IsRead = true;
			nextNotification.readAt = existing.readAt || existing.ReadAt || '';
			nextNotification.ReadAt = existing.ReadAt || existing.readAt || '';
		}
		nextList.splice(existingIndex, 1);
	}
	nextList.unshift(nextNotification);
	notificationList.value = nextList.slice(0, MAX_NOTIFICATION_COUNT);
	refreshUnreadNotificationCount();
	return nextNotification;
}

export async function loadPersonalCenterNotifications() {
	const response = await getNotifications();
	if (response?.code !== 0) throw new Error(response?.message || '通知列表加载失败');
	const data = response?.data || {};
	const notifications = (Array.isArray(data.items) ? data.items : [])
		.map((item) => normalizeNotification(item))
		.filter((item) => !isHiddenPersonalCenterNotification(item))
		.sort((left, right) => getNotificationTime(right) - getNotificationTime(left));
	notificationList.value = notifications;
	refreshUnreadNotificationCount();
	return notificationList.value;
}

function patchNotificationReadState(notificationIds = []) {
	if (!Array.isArray(notificationIds) || !notificationIds.length) return;

	const idSet = new Set(notificationIds.map((item) => safeString(item)).filter(Boolean));
	if (!idSet.size) return;

	const readAt = new Date().toISOString();
	notificationList.value = notificationList.value.map((item) => (
		idSet.has(item.id)
			? { ...item, isRead: true, IsRead: true, readAt, ReadAt: readAt }
			: item
	));
	refreshUnreadNotificationCount();
}

function pushEnvelope(envelope) {
	const nextList = envelopeList.value.slice();
	nextList.unshift(envelope);
	envelopeList.value = nextList.slice(0, MAX_EVENT_COUNT);
	lastEnvelope.value = envelope;
}

function handleRefreshSignal(envelope) {
	if (!envelope.needRefresh && !envelope.refreshHints.length) return;
	lastRefreshSignal.value = {
		eventId: envelope.eventId || `refresh-${Date.now()}`,
		needRefresh: envelope.needRefresh,
		refreshHints: envelope.refreshHints,
		occurredAt: envelope.occurredAt || new Date().toISOString(),
	};
}

function sendRawMessage(payload) {
	if (!socket || socket.readyState !== window.WebSocket.OPEN) {
		throw new Error('Realtime WebSocket is not connected');
	}
	socket.send(JSON.stringify(payload));
}

function sendPong() {
	if (!socket || socket.readyState !== window.WebSocket.OPEN) return;
	sendRawMessage({ eventType: 'pong' });
}

function scheduleReconnect() {
	if (manualClose || reconnectTimer || !hasAuthSession()) return;
	if (isRealtimeEndpointUnsupported()) {
		connectionStatus.value = 'error';
		return;
	}

	connectionStatus.value = 'reconnecting';
	const delay = resolveReconnectDelay();
	reconnectTimer = window.setTimeout(() => {
		reconnectTimer = null;
		connectPersonalCenterRealtime().catch(() => {});
	}, delay);
	reconnectAttempt += 1;
}

function handleSocketClose(currentSocket) {
	if (socket !== currentSocket) return;
	socket = null;
	if (manualClose) {
		connectionStatus.value = 'idle';
		return;
	}
	connectionStatus.value = 'disconnected';
	scheduleReconnect();
}

function handleReadSync(envelope) {
	const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
	const notificationIds = [
		payload.notificationId,
		envelope.notificationId,
		...(Array.isArray(payload.notificationIds) ? payload.notificationIds : []),
	].map((item) => safeString(item)).filter(Boolean);

	patchNotificationReadState(notificationIds);
	refreshUnreadNotificationCount();
}

function handleSocketMessage(event) {
	let payload = event?.data;
	if (typeof payload === 'string') {
		try {
			payload = JSON.parse(payload);
		} catch {
			return;
		}
	}

	if (!payload || typeof payload !== 'object') return;

	if (isOtherDeviceLoginAlertMessage(payload)) {
		securityMessageListeners.forEach((listener) => {
			try { listener(payload); } catch (error) { console.error('[personal-center-realtime] security listener failed', error); }
		});
	}

	const envelope = normalizeEnvelope(payload);
	if (envelope.eventId && !rememberEventId(envelope.eventId)) {
		return;
	}

	refreshUnreadNotificationCount();

	if (envelope.eventType === 'ping') {
		sendPong();
		return;
	}

	if (envelope.eventType === 'notification_read_sync') {
		handleReadSync(envelope);
		pushEnvelope(envelope);
		handleRefreshSignal(envelope);
		return;
	}

	let notification;
	if (envelope.notification) {
		notification = upsertNotification(envelope.notification);
	} else if (envelope.eventType === 'report_submit_reminder') {
		notification = upsertNotification({
			id: envelope.notificationId || envelope.eventId,
			type: envelope.eventType,
			content: safeString(pickValue(envelope.payload || {}, ['content', 'message', 'Message']), ''),
			title: safeString(pickValue(envelope.payload || {}, ['title', 'Title']), '日志提交提醒'),
			isRead: false,
			createdAt: envelope.occurredAt,
		});
	}

	if (notification) {
		for (const listener of notificationListeners) {
			try { listener(notification); } catch (error) { console.error('[personal-center-realtime] notification listener failed', error); }
		}
	}
	pushEnvelope(envelope);
	handleRefreshSignal(envelope);
}

export async function connectPersonalCenterRealtime() {
	if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') return null;
	if (isRealtimeEndpointUnsupported()) {
		connectionStatus.value = 'error';
		return null;
	}
	if (socket && (socket.readyState === window.WebSocket.OPEN || socket.readyState === window.WebSocket.CONNECTING)) {
		return socket;
	}
	if (connectPromise) {
		return connectPromise;
	}

	const generation = ++connectionGeneration;
	const pending = (async () => {
		manualClose = false;
		clearReconnectTimer();
		connectionStatus.value = reconnectAttempt > 0 ? 'reconnecting' : 'connecting';

		let tokenData;
		try {
			tokenData = await getRealtimeToken();
		} catch (error) {
			if (generation !== connectionGeneration) return null;
			// 404/405/501 = this backend has no realtime endpoint. Stop retrying
			// for a while; the HTTP notification snapshot remains the fallback.
			if ([404, 405, 501].includes(Number(error?.status))) {
				markRealtimeEndpointUnsupported();
				connectionStatus.value = 'error';
			}
			throw error;
		}
		if (generation !== connectionGeneration) return null;
		const wsToken = safeString(pickValue(tokenData || {}, ['wsToken', 'WsToken']), '');
		if (!wsToken) {
			connectionStatus.value = 'error';
			throw new Error('Missing realtime wsToken');
		}

		const wsUrl = safeString(pickValue(tokenData || {}, ['wsUrl', 'WsUrl']), '');
		const lastEventId = readLastEventId();
		const nextSocket = new window.WebSocket(buildSocketUrl(wsUrl, wsToken, lastEventId));
		socket = nextSocket;

		await new Promise((resolve, reject) => {
			let didOpen = false;
			nextSocket.onopen = () => {
				if (socket !== nextSocket) {
					resolve();
					return;
				}
				didOpen = true;
				reconnectAttempt = 0;
				connectionStatus.value = 'connected';
				resolve();
			};
			nextSocket.onmessage = (messageEvent) => {
				if (socket === nextSocket) handleSocketMessage(messageEvent);
			};
			nextSocket.onerror = () => {
				if (socket === nextSocket && connectionStatus.value !== 'connected') {
					connectionStatus.value = 'error';
				}
			};
			nextSocket.onclose = () => {
				if (!didOpen) {
					reject(new Error('Realtime WebSocket closed before opening'));
				}
				handleSocketClose(nextSocket);
			};
			nextSocket.addEventListener('error', () => {
				if (nextSocket.readyState !== window.WebSocket.OPEN) {
					reject(new Error('Realtime WebSocket failed to connect'));
				}
			}, { once: true });
		});

		return nextSocket;
	})();

	connectPromise = pending;
	try {
		return await pending;
	} finally {
		if (connectPromise === pending) connectPromise = null;
	}
}

export function disconnectPersonalCenterRealtime(options = {}) {
	const { clearState = false } = options;
	connectionGeneration += 1;
	connectPromise = null;
	manualClose = true;
	clearReconnectTimer();
	reconnectAttempt = 0;
	connectionStatus.value = 'idle';

	if (socket) {
		const currentSocket = socket;
		socket = null;
		currentSocket.close();
	}

	if (clearState) {
		envelopeList.value = [];
		notificationList.value = [];
		lastEnvelope.value = null;
		lastRefreshSignal.value = null;
		unreadNotificationCount.value = 0;
		recentEventIds.splice(0, recentEventIds.length);
		try {
			localStorage.removeItem(LAST_EVENT_ID_STORAGE_KEY);
		} catch {
			// Ignore storage failures.
		}
	}
}

export async function markRealtimeNotificationRead(notification) {
	const notificationId = safeString(notification?.id || notification?.notificationId || notification, '');
	if (!notificationId) return;
	const wasUnread = notificationList.value.some((item) => item.id === notificationId && !item.isRead);

	await markNotificationRead(notificationId);
	patchNotificationReadState([notificationId]);
	if (wasUnread) refreshUnreadNotificationCount();
}

export async function markReportReminderRead(notification) {
	return markRealtimeNotificationRead(notification);
}

export function removePersonalCenterNotification(notification) {
	const key = safeString(notification?.__key, '');
	const id = safeString(notification?.id || notification?.notificationId || notification?.Id, '');
	const target = notificationList.value.find((item) => (
		(key && item.__key === key) || (id && item.id === id)
	));
	if (!target) return false;
	notificationList.value = notificationList.value.filter((item) => item !== target);
	if (!target.isRead) refreshUnreadNotificationCount();
	return true;
}

export function usePersonalCenterRealtime() {
	return {
		connectionStatus: readonly(connectionStatus),
		isPersonalCenterRealtimeConnected: readonly(isPersonalCenterRealtimeConnected),
		envelopeList: readonly(envelopeList),
		notificationList: readonly(notificationList),
		lastEnvelope: readonly(lastEnvelope),
		lastRefreshSignal: readonly(lastRefreshSignal),
		unreadNotificationCount: readonly(unreadNotificationCount),
		reportReminders: readonly(reportReminders),
		unreadReportReminders: readonly(unreadReportReminders),
		latestReportReminder: readonly(latestReportReminder),
		connectPersonalCenterRealtime,
		disconnectPersonalCenterRealtime,
		onPersonalCenterSecurityMessage,
		markRealtimeNotificationRead,
		markReportReminderRead,
		removePersonalCenterNotification,
		loadPersonalCenterNotifications,
	};
}
