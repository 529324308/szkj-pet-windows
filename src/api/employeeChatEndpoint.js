const configuredHttpBase = String(import.meta.env?.VITE_EMPLOYEE_CHAT_API_BASE_URL || '').trim();
const configuredWebSocketBase = String(import.meta.env?.VITE_EMPLOYEE_CHAT_WS_BASE_URL || '').trim();

export const EMPLOYEE_CHAT_BASE_URL = (
	configuredHttpBase || (import.meta.env?.DEV ? '/knowledge-api' : '/api')
).replace(/\/$/, '');

export function resolveEmployeeChatUrl(path = '') {
	const normalizedPath = String(path || '');
	return `${EMPLOYEE_CHAT_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

export function resolveEmployeeChatWebSocketUrl(path = '') {
	const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
	const normalizedPath = String(path || '');
	const suffix = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
	const base = (configuredWebSocketBase || EMPLOYEE_CHAT_BASE_URL).replace(/\/$/, '');
	// The Vite knowledge proxy already rewrites /knowledge-api to /api. Keep
	// the public business socket path from becoming /api/api/chat/websocket.
	const proxySuffix = !configuredWebSocketBase && base === '/knowledge-api' && suffix.startsWith('/api/')
		? suffix.slice(4)
		: suffix;
	const url = new URL(`${base}${proxySuffix}`, origin);
	if (url.protocol === 'https:') url.protocol = 'wss:';
	else if (url.protocol === 'http:') url.protocol = 'ws:';
	return url.toString();
}
