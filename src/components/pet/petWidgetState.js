// 桌宠挂件共享状态：侧栏开关、外观、行为调节与隐私选项。
// 外观/尺寸/行为按账号保存一份（本机缓存 + 服务端 /api/pet-profile）。
// 窗口坐标与是否显示属于「本机」，不参与账号同步。
import { reactive, ref, watch } from 'vue';

const VISIBLE_KEY = 'szkj:pet:visible';
const POS_KEY = 'szkj:pet:position';
const LEGACY_LOOK_KEY = 'szkj:pet:look';
const LEGACY_TUNE_KEY = 'szkj:pet:tune';
const LEGACY_OPTIONS_KEY = 'szkj:pet:options';
const ACCOUNT_PREFIX = 'szkj:pet:account:';
const PROFILE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 900;

const DEFAULT_LOOK = {
  style: '2d',
  coat: 'black',
  pattern: 'auto',
  eye: 'auto',
  shine: 'classic',
  blush: false,
  whiskers: true,
  collar: 'none',
};
const DEFAULT_OPTIONS = { privacy: false, sleepAfter: 60, size: 50 };

let accountId = '';
let remoteLoader = null;
let remoteSaver = null;
let localUpdatedAt = '';
let applyingRemote = false;
let lastFingerprint = '';
let saveTimer = null;
let saving = false;
let pendingSave = false;

function readJSON(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式或配额失败时忽略，不影响主流程。
  }
}

/** 账号态下所有外观/行为 key 都带 userId，换账号不会互相污染。 */
function scopedKey(base) {
  return accountId ? `${ACCOUNT_PREFIX}${accountId}:${base}` : base;
}

function readVisible() {
  try {
    return window.localStorage.getItem(VISIBLE_KEY) === 'true';
  } catch {
    return false;
  }
}

const visible = ref(readVisible());
const look = reactive({ ...DEFAULT_LOOK });
const tune = reactive({});
const options = reactive({ ...DEFAULT_OPTIONS });
const position = reactive({ x: null, y: null, ...(readJSON(POS_KEY) || {}) });

function readStoredProfile() {
  const stored = readJSON(scopedKey('profile'));
  if (!stored || typeof stored !== 'object') return null;
  return {
    version: PROFILE_VERSION,
    updatedAt: String(stored.updatedAt || ''),
    look: { ...DEFAULT_LOOK, ...(stored.look || {}) },
    options: { ...DEFAULT_OPTIONS, ...(stored.options || {}) },
    tune: { ...(stored.tune || {}) },
  };
}

/** 首次登录到某个账号时，把旧的匿名配置迁移成该账号的初始配置。 */
function readLegacyProfile() {
  const legacyLook = readJSON(LEGACY_LOOK_KEY);
  const legacyOptions = readJSON(LEGACY_OPTIONS_KEY);
  const legacyTune = readJSON(LEGACY_TUNE_KEY);
  if (!legacyLook && !legacyOptions && !legacyTune) return null;
  return {
    version: PROFILE_VERSION,
    updatedAt: '',
    look: { ...DEFAULT_LOOK, ...(legacyLook || {}) },
    options: { ...DEFAULT_OPTIONS, ...(legacyOptions || {}) },
    tune: { ...(legacyTune || {}) },
  };
}

function collectProfile() {
  return {
    version: PROFILE_VERSION,
    updatedAt: localUpdatedAt,
    look: { ...look },
    options: { ...options },
    tune: { ...tune },
  };
}

/** 外观+行为指纹：只有真正变化才写盘/上云，避免恢复配置时自己触发一轮写入。 */
function fingerprint() {
  return JSON.stringify({ look: { ...look }, options: { ...options }, tune: { ...tune } });
}

function persistLocal() {
  lastFingerprint = fingerprint();
  writeJSON(scopedKey('profile'), collectProfile());
}

function applyProfile(profile) {
  if (!profile || typeof profile !== 'object') return;
  applyingRemote = true;
  try {
    Object.assign(look, { ...DEFAULT_LOOK, ...(profile.look || {}) });
    Object.keys(tune).forEach((key) => delete tune[key]);
    Object.assign(tune, profile.tune || {});
    Object.assign(options, { ...DEFAULT_OPTIONS, ...(profile.options || {}) });
    localUpdatedAt = String(profile.updatedAt || '');
    lastFingerprint = fingerprint();
  } finally {
    applyingRemote = false;
  }
}

function markChanged() {
  if (applyingRemote) return;
  if (fingerprint() === lastFingerprint) return;
  localUpdatedAt = new Date().toISOString();
  persistLocal();
  scheduleRemoteSave();
}

function scheduleRemoteSave(immediate = false) {
  if (!accountId || !remoteSaver) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushRemoteSave();
  }, immediate ? 0 : SAVE_DEBOUNCE_MS);
}

async function flushRemoteSave() {
  if (!accountId || !remoteSaver) return;
  if (saving) {
    pendingSave = true;
    return;
  }
  saving = true;
  try {
    const result = await remoteSaver(collectProfile());
    const serverAt = String(result?.updatedAt || '');
    if (serverAt && serverAt > localUpdatedAt) localUpdatedAt = serverAt;
    persistLocal();
  } catch (error) {
    // 网络失败不阻断本地使用，下一次修改会再次尝试。
    if (typeof console !== 'undefined') console.warn('[pet] profile sync failed', error?.message || error);
  } finally {
    saving = false;
    if (pendingSave) {
      pendingSave = false;
      scheduleRemoteSave(true);
    }
  }
}

watch(look, () => markChanged(), { deep: true });
watch(tune, () => markChanged(), { deep: true });
watch(options, () => markChanged(), { deep: true });
watch(position, () => writeJSON(POS_KEY, { ...position }), { deep: true });

/**
 * 绑定账号：先读本机该账号缓存（首屏立即生效），再拉服务端。
 * 合并规则：updatedAt 更新的一方胜出；服务端为空或更旧就反向推送本地。
 */
export async function bindPetAccount({ userId, load, save } = {}) {
  const nextId = String(userId || '').trim();
  if (!nextId) return;
  accountId = nextId;
  remoteLoader = typeof load === 'function' ? load : null;
  remoteSaver = typeof save === 'function' ? save : null;

  let local = readStoredProfile();
  if (!local) {
    local = readLegacyProfile();
    if (local) {
      local.updatedAt = new Date().toISOString();
      localUpdatedAt = local.updatedAt;
      writeJSON(scopedKey('profile'), { ...local });
    }
  }

  applyProfile(local || { look: DEFAULT_LOOK, options: DEFAULT_OPTIONS, tune: {} });
  if (!local) persistLocal(); // 新账号先落一份本机缓存，断网启动也有稳定初值

  if (!remoteLoader) return;
  try {
    const response = await remoteLoader();
    if (remoteLoader !== load) return; // 期间又绑定了别的账号，这次结果作废
    // 适配器返回 { profile, updatedAt }；profile 为 null 表示服务端还没存过。
    const envelope = response && typeof response === 'object' && 'profile' in response;
    const remote = envelope ? response.profile : response;
    const remoteAt = String((envelope ? response.updatedAt : remote?.updatedAt) || '');
    if (remote && typeof remote === 'object' && Object.keys(remote).length) {
      const normalized = {
        version: PROFILE_VERSION,
        updatedAt: remoteAt,
        look: remote.look,
        options: remote.options,
        tune: remote.tune,
      };
      // 时间戳相等也以服务端为准：避免每次启动都因为「本地不新」而重复回推。
      if (!localUpdatedAt || normalized.updatedAt >= localUpdatedAt) {
        applyProfile(normalized);
        localUpdatedAt = normalized.updatedAt || localUpdatedAt;
        persistLocal();
        return;
      }
    }
    scheduleRemoteSave(true);
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[pet] profile load failed', error?.message || error);
  }
}

/** 退出登录：解绑账号，回到匿名配置，等下次登录再绑定。 */
export function unbindPetAccount() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  accountId = '';
  remoteLoader = null;
  remoteSaver = null;
  localUpdatedAt = '';
  const legacy = readLegacyProfile();
  applyProfile(legacy || { look: DEFAULT_LOOK, options: DEFAULT_OPTIONS, tune: {} });
}

/** 当前是否已绑定账号（桌面壳据此判断要不要等登录）。 */
export function hasPetAccount() {
  return Boolean(accountId);
}

function toggleVisible() {
  visible.value = !visible.value;
  try {
    window.localStorage.setItem(VISIBLE_KEY, visible.value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

function setLook(partial) {
  Object.assign(look, partial);
}

function applyTune(partial) {
  Object.assign(tune, partial);
}

function resetTune() {
  Object.keys(tune).forEach((k) => delete tune[k]);
}

function setOption(partial) {
  Object.assign(options, partial);
}

function setPosition(x, y) {
  position.x = x;
  position.y = y;
}

function clearPosition() {
  position.x = null;
  position.y = null;
}

export function usePetWidgetState() {
  return {
    visible,
    look,
    tune,
    options,
    position,
    defaultLook: DEFAULT_LOOK,
    toggleVisible,
    setLook,
    applyTune,
    resetTune,
    setOption,
    setPosition,
    clearPosition,
    bindPetAccount,
    unbindPetAccount,
    getAccountId: () => accountId,
    getProfileSnapshot: collectProfile,
  };
}
