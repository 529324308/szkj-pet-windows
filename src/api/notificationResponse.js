function firstDefined(...values) {
	return values.find((value) => value !== undefined && value !== null);
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value, fallback = false) {
	if (value === true || value === 'true' || value === 1 || value === '1') return true;
	if (value === false || value === 'false' || value === 0 || value === '0') return false;
	return fallback;
}

export function unwrapManagementCenterData(response) {
	return response?.data ?? response;
}

export function normalizePagedResponse(response, normalizeItem = (item) => item) {
	const data = unwrapManagementCenterData(response);
	const rawItems = Array.isArray(data) ? data : (data?.items ?? data?.data ?? data);
	const items = asArray(rawItems).map(normalizeItem);
	return {
		...response,
		data: {
			items,
			total: asNumber(data?.total, items.length),
			pageIndex: asNumber(data?.pageIndex, 1),
			pageSize: asNumber(data?.pageSize, 10),
			totalPages: asNumber(data?.totalPages, items.length ? 1 : 0),
			unreadCount: data?.unreadCount === undefined ? undefined : asNumber(data.unreadCount),
			metrics: data?.metrics ?? null,
		},
	};
}

export function normalizeManagementCenterNotification(item = {}) {
	return {
		...item,
		id: String(firstDefined(item.id, item.notificationId, '') || ''),
		type: String(firstDefined(item.type, '') || ''),
		title: String(firstDefined(item.title, '') || ''),
		content: String(firstDefined(item.content, item.message, '') || ''),
		relatedType: String(firstDefined(item.relatedType, '') || ''),
		relatedId: firstDefined(item.relatedId, null),
		isRead: asBoolean(firstDefined(item.isRead, item.read)),
		createdAt: firstDefined(item.createdAt, item.CreateTime, ''),
	};
}
