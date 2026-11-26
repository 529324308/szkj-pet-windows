import { createApp, h, ref, watch } from 'vue';
import KeyCatWidget from '../components/pet/KeyCatWidget.vue';
import { usePetWidgetState } from '../components/pet/petWidgetState';
import { useDesktopRealtime } from './realtime.js';

const petState = usePetWidgetState();

// 桌面版入口：只挂桌宠，不加载管理中心、地图和 Cesium。
const loggedIn = ref(Boolean(localStorage.getItem('accessToken')));
const notice = ref(null);
// 右下角状态条：账号名 + 连通指示灯（green 已连通 / gray 未登录 / red 失效或超时）。
const accountName = ref('');
const petStatus = ref(loggedIn.value ? 'error' : 'offline');

const API_BASE = String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/?$/u, '');
let realtime;
let sessionToken = '';
let liveUserId = '';
let sessionGeneration = 0;

/** 令牌里的 exp 已经过期就别再显示“已登录”。 */
function tokenExpired(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(part))));
    const exp = Number(payload?.exp || 0);
    return exp > 0 && exp * 1000 <= Date.now() + 5000;
  } catch {
    return false;
  }
}

/** 清掉宿主与页面里的令牌，回到未登录状态。 */
async function clearDesktopToken(reason) {
  sessionToken = '';
  liveUserId = '';
  sessionGeneration += 1;
  realtime?.stop();
  petState.unbindPetAccount();
  localStorage.removeItem('accessToken');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_token');
  } catch (error) {
    console.warn('[pet] clear_token failed', error);
  }
  loggedIn.value = false;
  accountName.value = '';
  petStatus.value = 'offline';
  notice.value = null;
  requireLogin(reason || '登录已失效，请重新登录。');
}

async function resolveAccount(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const response = await fetch(`${API_BASE}/api/PersonalCenter/current-user`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw Object.assign(new Error('账号状态暂不可用'), { status: response.status });
  const payload = await response.json();
  const user = payload?.data ?? payload;
  const userIds = new Set([
    user?.id, user?.Id, user?.userId, user?.UserId, user?.employeeId, user?.EmployeeId,
    user?.userName, user?.UserName, tokenUserId(token),
  ].filter(Boolean).map(String));
  if (!userIds.size) throw new Error('账号信息缺少标识');
  const name = user?.displayName || user?.DisplayName || user?.realName || user?.RealName
    || user?.name || user?.Name || user?.userName || user?.UserName || userIds.values().next().value;
  return { name: String(name), userIds };
}

// 未登录时不是盖一层表单，而是让猫先出来，用气泡提示 + 两个按钮引导。
let autoHideTimer = null;

function clearAutoHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

function requireLogin(text = '登录后猫才能接收平台通知和员工消息。') {
  // 提示只停留一分钟，避免一直挡在桌面上。
  clearAutoHide();
  autoHideTimer = setTimeout(() => {
    notice.value = null;
    autoHideTimer = null;
  }, 60000);
  notice.value = {
    title: '尚未登录数治空间',
    text,
    actions: [
      { kind: 'login', label: '打开登录窗口', primary: true },
      { kind: 'skip', label: '稍后' },
    ],
  };
}

if (!loggedIn.value) requireLogin();

async function handleNoticeAction(kind) {
  if (kind === 'skip') {
    clearAutoHide();
    notice.value = null;
    return;
  }
  if (kind !== 'login') return;
  notice.value = {
    ...notice.value,
    text: '已打开登录窗口，请在其中完成登录。',
    actions: [{ kind: 'skip', label: '稍后' }],
  };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_login');
  } catch (error) {
    requireLogin('登录窗口打不开，试试点托盘里的「登录 / 重新登录」。');
    console.warn('[pet] open_login failed', error);
  }
}

async function reportLoginState(connected) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_login_state', { connected: Boolean(connected) });
  } catch (error) {
    console.warn('[pet] login state report failed', error);
  }
}


/** 从令牌里取 userId（后端 JWT 的 sub），用来绑定账号级桌宠配置。 */
function tokenUserId(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(part))));
    return String(payload?.sub || payload?.nameid || '');
  } catch {
    return '';
  }
}

/** 桌宠配置接口：沿用当前环境的业务入口。 */
async function petProfileRequest(token, method, body) {
  const response = await fetch(`${API_BASE}/api/pet-profile`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  return json?.data ?? json ?? {};
}

/** 登录后把外观/尺寸绑到账号：服务端较新就用服务端，否则把本机配置推上去。 */
async function bindDesktopPetProfile(token) {
  const userId = tokenUserId(token);
  if (!userId) return;
  await petState.bindPetAccount({
    userId,
    load: () => petProfileRequest(token, 'GET'),
    save: (profile) => petProfileRequest(token, 'PUT', { profile }),
  });
}

async function connectWithToken(token) {
  const value = String(token || '').trim();
  if (!value || value === sessionToken) return;
  const generation = ++sessionGeneration;
  sessionToken = value;
  const refreshedUserId = tokenUserId(value);
  const sameUser = Boolean(liveUserId && liveUserId === refreshedUserId);
  if (!sameUser) {
    liveUserId = '';
    realtime.stop();
    petState.unbindPetAccount();
    accountName.value = '';
    petStatus.value = 'error';
  }
  localStorage.setItem('accessToken', value);
  localStorage.removeItem('expiresIn');
  localStorage.removeItem('refreshToken');
  try {
    const account = await resolveAccount(value);
    if (generation !== sessionGeneration) return;
    accountName.value = account.name;
    loggedIn.value = true;
    clearAutoHide();
    notice.value = null;
    if (!sameUser) {
      liveUserId = refreshedUserId;
      realtime.start(account.userIds);
    }
    bindDesktopPetProfile(value).catch(() => {});
  } catch (error) {
    if (generation !== sessionGeneration) return;
    if (error.status === 401 || error.status === 403 || tokenExpired(value)) {
      await clearDesktopToken('登录已失效，请重新登录。');
      return;
    }
    // 保留宿主令牌，由状态轮询或网页推送重试连接。
    sessionToken = '';
    if (!realtime.connected.value) petStatus.value = 'error';
  }
}

const MENU_LOOK_KEYS = new Set(['style', 'coat', 'eye', 'shine', 'collar', 'blush', 'whiskers']);

async function applyMenuAction(action, value) {
  if (MENU_LOOK_KEYS.has(action)) {
    const normalized = action === 'blush' || action === 'whiskers' ? value === 'true' : value;
    petState.setLook({ [action]: normalized });
    return;
  }
  if (action === 'size') {
    petState.setOption({ size: Number(value) || 50 });
    return;
  }
  if (action === 'sleep') {
    petState.setOption({ sleepAfter: Number(value) || 0 });
    return;
  }
  if (action === 'privacy') {
    petState.setOption({ privacy: value === 'true' });
    return;
  }
  if (action === 'reset') return handleDesktopAction('reset');
  if (action === 'login') return handleNoticeAction('login');
  if (action === 'quit') return handleDesktopAction('quit');
  if (action === 'toggle') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_visible');
    } catch (error) {
      console.warn('[pet] toggle failed', error);
    }
  }
}

async function handleDesktopAction(kind, payload) {
  // 挂件里既有 desktopAction('reset') 这种两参调用，也有 openMenu 里带状态的一次性对象。
  if (kind && typeof kind === 'object') {
    payload = kind.payload;
    kind = kind.kind;
  }
  if (kind === 'open-platform') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_platform');
    } catch (error) {
      console.warn('[pet] open platform failed', error);
    }
    return;
  }
  if (kind === 'login') return handleNoticeAction('login');
  if (kind === 'hide') return applyMenuAction('toggle');
  if (kind === 'reset') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reset_position');
    } catch (error) {
      console.warn('[pet] reset position failed', error);
    }
    return;
  }
  if (kind !== 'quit') return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_app');
  } catch (error) {
    console.warn('[pet] quit failed', error);
  }
}

createApp({
  setup() {
    realtime = useDesktopRealtime();
    watch(realtime.connected, (connected) => {
      if (loggedIn.value) petStatus.value = connected ? 'online' : 'error';
      void reportLoginState(connected);
    });
    return () => h(KeyCatWidget, {
      desktop: true,
      notice: notice.value,
      accountName: accountName.value,
      status: petStatus.value,
      onNoticeAction: handleNoticeAction,
      onDesktopAction: handleDesktopAction,
    });
  },
}).mount('#app');

// Tauri 环境：CORS 由插件接管、拖动改成挪动窗口、全局键鼠由宿主转发。
const isTauri = Boolean(window.__TAURI_INTERNALS__);
if (isTauri) {
  document.documentElement.dataset.szkjPetShell = 'tauri';

  // 桌面壳没有同源代理，直连平台接口会被 CORS 拦；把跨域请求交给 tauri-plugin-http。
  const setupNativeHttp = (async () => {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (/^https?:\/\//i.test(url)) return tauriFetch(input, init);
        return nativeFetch(input, init);
      };
    } catch (error) {
      console.warn('[pet] http plugin unavailable', error);
    }
  })();

  // 拖动由宿主接管：全局左键按下时宿主记录起点并按位移移动窗口。
  // 系统 startDragging 会在指针离开猫的范围后失效，表现成拖到一半卡住。
  window.__szkjPetDesktopDrag = () => {};
  if (/^Win/i.test(window.navigator.userAgentData?.platform || window.navigator.platform)) {
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      window.__szkjPetDesktopDrag = () => {
        invoke('begin_windows_drag').catch((error) => console.warn('[pet] drag failed', error));
      };
    });
  }

  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      window.__szkjPetLog = (line) => invoke('debug_log', { line: String(line) }).catch(() => {});
      // 只在挂载或缩放时为气泡预留窗口空间。
      window.__szkjPetFitHeight = (height) => {
        invoke('set_window_height', { height: Number(height) || 0 })
          .catch((error) => console.warn('[pet] set_window_height failed', error));
      };
      window.__szkjPetSyncHitRect = (rect) => {
        invoke('set_hit_rect', {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }).catch((error) => console.warn('[pet] set_hit_rect failed', error));
      };
      window.__szkjPetResyncHitRect = () => window.dispatchEvent(new Event('resize'));
      // 桥是挂载之后才装上的，挂件首次上报会因函数不存在而跳过；这里补一次。
      window.__szkjPetResyncHitRect();
      window.dispatchEvent(new Event('pet:bridge-ready'));

      const { listen } = await import('@tauri-apps/api/event');
      await listen('pet:token', async (event) => {
        await setupNativeHttp;
        await connectWithToken(event?.payload);
      });
      await listen('pet:logout', () => {
        void clearDesktopToken('网页端已退出登录。');
      });
      await listen('pet:demo-menu', () => window.dispatchEvent(new Event('pet:demo-menu')));
      await listen('pet:menu-action', (event) => {
        const action = String(event?.payload?.action || '');
        const value = String(event?.payload?.value || '');
        if (action) applyMenuAction(action, value);
      });
      // 网页端改了外观/大小时通过本机桥推过来，桌宠立刻跟上并落盘。
      await listen('pet:remote-config', (event) => {
        try {
          const config = JSON.parse(String(event?.payload || '{}'));
          if (config.look) petState.setLook(config.look);
          if (config.options) petState.setOption(config.options);
        } catch (error) {
          console.warn('[pet] remote config parse failed', error);
        }
      });

      const pushConfig = () => {
        const payload = JSON.stringify({
          look: { ...petState.look },
          options: { ...petState.options },
        });
        invoke('set_config_cache', { config: payload }).catch(() => {});
      };
      pushConfig();
      watch(() => [petState.look, petState.options], pushConfig, { deep: true });
      // 窗口默认鼠标穿透且不抢焦点，系统不会把全局键鼠派发给页面；
      // 宿主转发回来这里还原成 DOM 事件，让既有行为代码原样生效。
      await listen('pet:input', (event) => {
        const payload = event?.payload;
        if (!payload) return;
        if (payload.kind === 'keydown' || payload.kind === 'keyup' || payload.kind === 'mousemove') {
          // 直接交给挂件里的场景，不再合成 DOM 事件：桌面壳不抢焦点，
          // 合成出来的 KeyboardEvent 到不了场景的按键映射。
          window.dispatchEvent(new CustomEvent('pet:desktop-input', { detail: payload }));
          return;
        }
        if (payload.kind === 'mousedown') {
          window.dispatchEvent(new CustomEvent('pet:global-mousedown', { detail: payload }));
          return;
        }
      });
    } catch (error) {
      console.warn('[pet] tauri bridge unavailable', error);
    }
  })();

  // 令牌由宿主持久化，启动和网页推送共用同一条接入路径。
  void (async () => {
    await setupNativeHttp;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const saved = await invoke('read_token');
      if (sessionToken) return;
      if (saved && !tokenExpired(saved)) {
        await connectWithToken(saved);
      } else if (saved) {
        await clearDesktopToken('登录已过期，请重新登录。');
      } else {
        localStorage.removeItem('accessToken');
        loggedIn.value = false;
        petStatus.value = 'offline';
        if (!notice.value) requireLogin();
      }
    } catch (error) {
      console.warn('[pet] read_token failed', error);
    }
  })();

  setInterval(() => {
    const token = localStorage.getItem('accessToken');
    if (token && tokenExpired(token)) void clearDesktopToken('登录已过期，请重新登录。');
    else if (token && !sessionToken) void connectWithToken(token);
  }, 10000);
}
