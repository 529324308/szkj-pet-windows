import { requestJson } from './request.js';
import { resolveEmployeeChatUrl } from './employeeChatEndpoint.js';

export function exchangeEmployeeChatIdentity(payload) {
  return requestJson(resolveEmployeeChatUrl('/chat/auth/exchange'), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
