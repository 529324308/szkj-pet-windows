const SECURITY_ALERT_BIZ_TYPE = 'other_device_login_alert';
const NESTED_KEYS = ['payload', 'Payload', 'notification', 'Notification', 'message', 'Message'];

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function parseNestedJsonString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function inspectSource(source, depth, seen) {
  if (depth > 2 || source === null || source === undefined) return false;

  const parsed = parseNestedJsonString(source);
  if (parsed && typeof parsed === 'object') {
    if (seen.has(parsed)) return false;
    seen.add(parsed);
  }

  const current = parsed;
  const objectValue = safeObject(current);
  if (!objectValue) return false;

  const bizType = safeString(objectValue.BizType || objectValue.bizType || objectValue.BIZTYPE || '');
  if (bizType.toLowerCase() === SECURITY_ALERT_BIZ_TYPE) return true;

  for (const key of NESTED_KEYS) {
    if (inspectSource(objectValue[key], depth + 1, seen)) return true;
  }

  return false;
}

export function isOtherDeviceLoginAlertMessage(payload) {
  return inspectSource(payload, 0, new Set());
}
