const businessBase = import.meta.env?.VITE_API_BASE_URL || 'https://zjshuzhi.cn:8084';

export function resolveBusinessUrl(path) {
  return new URL(path, businessBase).toString();
}

export function getValidAccessToken() {
  return localStorage.getItem('accessToken') || '';
}

export async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/json');
  const token = getValidAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function requestBusinessJson(path) {
  const data = await requestJson(resolveBusinessUrl(path));
  if (data?.code !== undefined && Number(data.code) !== 0) {
    throw new Error(data.message || `业务请求失败（${data.code}）`);
  }
  return data;
}
