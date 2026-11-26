import { requestBusinessJson } from './request.js';
import { normalizeManagementCenterNotification, normalizePagedResponse } from './notificationResponse.js';

export async function getNotifications() {
  const response = await requestBusinessJson('/api/PersonalCenter/notifications');
  return normalizePagedResponse(response, normalizeManagementCenterNotification);
}

export function getRealtimeToken() {
  return requestBusinessJson('/api/PersonalCenter/realtime/token');
}

export function markNotificationRead(notificationId) {
  return requestBusinessJson(`/api/PersonalCenter/notifications/${encodeURIComponent(notificationId)}/read`);
}
