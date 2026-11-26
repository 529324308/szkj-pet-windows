<template>
  <div
    ref="wrapRef"
    v-if="enabled"
    class="pet-widget"
    :style="wrapStyle"
    @contextmenu.prevent="openMenu"
  >
      <div
        ref="stageRef"
        class="pet-widget__stage"
        :style="stageStyle"
        @pointerdown="onStagePointerDown"
      ></div>

      <transition :name="desktop ? 'pet-desktop-bubble' : 'pet-bubble'">
        <div
          v-if="bubble"
          ref="bubbleRef"
          class="pet-bubble"
          :style="bubbleStyle"
          @pointerdown.stop
          @click="onBubbleClick"
        >
          <div class="pet-bubble__meta">
            <span class="pet-bubble__label">{{ bubble.label }}</span>
            <span v-if="bubble.title" class="pet-bubble__title">{{ bubble.title }}</span>
          </div>
          <p class="pet-bubble__text">{{ bubble.text }}</p>
        </div>
      </transition>

      <transition :name="desktop ? 'pet-desktop-bubble' : 'pet-bubble'">
        <div
          v-if="notice && !bubble"
          ref="noticeRef"
          class="pet-bubble pet-notice"
          :style="noticeStyle"
          @pointerdown.stop
        >
          <div class="pet-bubble__meta">
            <span class="pet-bubble__label">{{ notice.title }}</span>
          </div>
          <p v-if="notice.text" class="pet-bubble__text">{{ notice.text }}</p>
          <div class="pet-notice__actions">
            <button
              v-for="action in notice.actions || []"
              :key="action.kind"
              type="button"
              class="pet-notice__button"
              :class="{ 'is-primary': action.primary }"
              @click="$emit('notice-action', action.kind)"
            >
              {{ action.label }}
            </button>
          </div>
        </div>
      </transition>

      <div
        v-if="desktop"
        ref="statusRef"
        class="pet-status"
        :class="`pet-status--${status}`"
        :title="statusText"
        @pointerdown.stop
        @click.stop="$emit('desktop-action', 'open-platform')"
      >
        <span class="pet-status__dot"></span>
        <span class="pet-status__name">{{ accountName || (status === 'offline' ? '未登录' : '未连接') }}</span>
      </div>

      <transition name="pet-menu">
        <div
          v-if="menuOpen"
          ref="menuRef"
          class="pet-menu"
          :style="menuStyle"
          @contextmenu.prevent.stop
        >
          <template v-if="view === 'main'">
            <button
              type="button"
              class="pet-menu__row"
              :class="{ 'is-on': look.style === '3d' }"
              @click="setLook({ style: look.style === '3d' ? '2d' : '3d' })"
            >
              <span>{{ look.style === '3d' ? '立体效果（3D）' : '平面效果（2D）' }}</span>
              <span class="pet-menu__mark">{{ look.style === '3d' ? '✓' : '' }}</span>
            </button>
            <button type="button" class="pet-menu__row" @click="view = 'coat'">
              <span>毛色</span><span class="pet-menu__chev">›</span>
            </button>
            <button type="button" class="pet-menu__row" @click="view = 'look'">
              <span>外观</span><span class="pet-menu__chev">›</span>
            </button>
            <button type="button" class="pet-menu__row" @click="view = 'size'">
              <span>大小</span><span class="pet-menu__chev">›</span>
            </button>
            <button type="button" class="pet-menu__row" @click="view = 'sleep'">
              <span>多久睡着</span><span class="pet-menu__chev">›</span>
            </button>
            <button
              type="button"
              class="pet-menu__row"
              @click="setOption({ privacy: !options.privacy })"
            >
              <span>隐私模式（不显示键名）</span>
              <span class="pet-menu__mark">{{ options.privacy ? '✓' : '' }}</span>
            </button>

            <div class="pet-menu__sep"></div>
            <button v-if="!desktop" type="button" class="pet-menu__row" @click="view = 'downloads'">
              <span>下载桌面端</span><span class="pet-menu__chev" aria-hidden="true">›</span>
            </button>
            <button type="button" class="pet-menu__row" @click="resetPosition">
              <span>回到右下角</span>
            </button>
            <div class="pet-menu__sep"></div>
            <button type="button" class="pet-menu__row" @click="hideWidget">
              <span>隐藏宠物</span>
            </button>
            <template v-if="desktop">
              <button type="button" class="pet-menu__row" @click="desktopAction('login')">
                <span>登录 / 重新登录</span>
              </button>
              <button type="button" class="pet-menu__row" @click="desktopAction('quit')">
                <span>退出桌宠</span>
              </button>
            </template>
          </template>

          <template v-else-if="view === 'downloads'">
            <button type="button" class="pet-menu__row pet-menu__back" @click="view = 'main'">
              <span>‹ 返回</span>
            </button>
            <template v-for="item in desktopDownloads" :key="item.label">
              <a
                v-if="item.href"
                class="pet-menu__row pet-menu__download"
                :href="item.href"
                download
                @click="menuOpen = false"
              >{{ item.label }}</a>
              <button v-else type="button" class="pet-menu__row" disabled>
                <span>{{ item.label }}</span><span>未发布</span>
              </button>
            </template>
          </template>

          <template v-else-if="view === 'coat'">
            <button type="button" class="pet-menu__row pet-menu__back" @click="view = 'main'">
              ‹ 返回
            </button>
            <button
              v-for="c in COATS"
              :key="c.value"
              type="button"
              class="pet-menu__row"
              :class="{ 'is-on': look.coat === c.value }"
              @click="setLook({ coat: c.value })"
            >
              <span>{{ c.label }}</span>
              <span class="pet-menu__mark">{{ look.coat === c.value ? '✓' : '' }}</span>
            </button>
          </template>

          <template v-else-if="view === 'look'">
            <button type="button" class="pet-menu__row pet-menu__back" @click="view = 'main'">
              ‹ 返回
            </button>
            <label class="pet-menu__field">
              <span>花纹</span>
              <select v-model="look.pattern">
                <option value="auto">自动</option>
                <option value="tabby">虎斑</option>
                <option value="solid">纯色</option>
              </select>
            </label>
            <label class="pet-menu__field">
              <span>眼睛</span>
              <select v-model="look.eye">
                <option value="auto">跟随毛色</option>
                <option value="gold">金</option>
                <option value="green">绿</option>
                <option value="blue">蓝</option>
                <option value="amber">琥珀</option>
                <option value="copper">铜</option>
                <option value="odd">异色瞳</option>
              </select>
            </label>
            <label class="pet-menu__field">
              <span>高光</span>
              <select v-model="look.shine">
                <option value="none">无</option>
                <option value="classic">经典</option>
                <option value="sparkle">闪光</option>
              </select>
            </label>
            <label class="pet-menu__field">
              <span>项圈</span>
              <select v-model="look.collar">
                <option value="none">无</option>
                <option value="red">红</option>
                <option value="blue">蓝</option>
                <option value="pink">粉</option>
                <option value="green">绿</option>
              </select>
            </label>
            <label class="pet-menu__toggle">
              <span>腮红</span>
              <input type="checkbox" v-model="look.blush" />
            </label>
            <label class="pet-menu__toggle">
              <span>胡须</span>
              <input type="checkbox" v-model="look.whiskers" />
            </label>
          </template>

          <template v-else-if="view === 'size'">
            <button type="button" class="pet-menu__row pet-menu__back" @click="view = 'main'">
              ‹ 返回
            </button>
            <div class="pet-menu__slider">
              <div class="pet-menu__slider-head">
                <span>缩放</span>
                <span class="pet-menu__value">{{ options.size }}%</span>
              </div>
              <input
                type="range"
                :min="MIN_SIZE"
                :max="MAX_SIZE"
                :step="1"
                v-model.number="options.size"
              />
            </div>
          </template>

          <template v-else-if="view === 'sleep'">
            <button type="button" class="pet-menu__row pet-menu__back" @click="view = 'main'">
              ‹ 返回
            </button>
            <div class="pet-menu__slider">
              <div class="pet-menu__slider-head">
                <span>无操作多久睡着</span>
                <span class="pet-menu__value">{{ options.sleepAfter }} 秒</span>
              </div>
              <input
                type="range"
                min="10"
                max="300"
                step="5"
                v-model.number="options.sleepAfter"
              />
            </div>
          </template>
        </div>
      </transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PET_MESSAGE_EVENT, labelForSource } from '../../utils/petMessageBus';
import { usePetWidgetState } from './petWidgetState.js';
import { mountCore, unmountCore } from './scene/core.js';
import { initKeyboard } from './scene/keyboard.js';
import { initFur } from './scene/fur.js';
import { initCat } from './scene/cat.js';
import { createBehavior } from './scene/behavior.js';

const {
  visible,
  look,
  tune,
  options,
  position,
  setLook,
  setOption,
  setPosition,
  clearPosition,
  toggleVisible,
} = usePetWidgetState();

// 桌面版（Tauri 悬浮窗）里窗口本身就是宠物的容器：不受侧栏开关与移动端判定影响，
// 拖动也从「挪动页面里的盒子」改成「挪动整个窗口」。
const props = defineProps({
  desktop: { type: Boolean, default: false },
  // 宿主要求挂件弹出的提示气泡（例如「尚未登录平台」+ 操作按钮）。
  notice: { type: Object, default: null },
  // 桌面版右下角状态条：已登录账号名 + 连通指示灯。
  accountName: { type: String, default: '' },
  status: { type: String, default: 'offline' },
});
const emit = defineEmits(['notice-action', 'desktop-action']);

const COATS = [
  { value: 'black', label: '黑猫' },
  { value: 'tuxedo', label: '奶牛猫' },
  { value: 'orange', label: '橘猫' },
  { value: 'grey', label: '蓝灰猫' },
  { value: 'white', label: '白猫' },
  { value: 'calico', label: '三花猫' },
];

const enabled = computed(() => props.desktop || visible.value);
const wrapRef = ref(null);
const stageRef = ref(null);
const bubbleRef = ref(null);
const noticeRef = ref(null);
const menuRef = ref(null);
const statusRef = ref(null);
const menuOpen = ref(false);

const statusText = computed(() => ({
  online: '服务器已连通',
  offline: '未登录 / 未连接',
  error: '连接超时或登录已失效',
}[props.status] || ''));
let lastDomPointerDown = 0;
let menuOpenedAt = 0;

// 桌面壳里点在窗口外的鼠标事件由宿主转发过来：这类点击页面收不到，
// 菜单要自己关，否则会一直挂在桌面上。
function onGlobalMouseDown() {
  if (!menuOpen.value) return;
  // 右键刚把菜单打开时，这一下右键的全局事件也会到，不能当成"点外面"。
  if (Date.now() - menuOpenedAt < 300) return;
  const stamp = Date.now();
  setTimeout(() => {
    if (lastDomPointerDown > stamp) return;
    menuOpen.value = false;
  }, 180);
}
window.addEventListener('pointerdown', () => {
  lastDomPointerDown = Date.now();
}, true);
window.addEventListener('pet:global-mousedown', onGlobalMouseDown);
// 调试用：宿主发 pet:demo-menu 时直接把主菜单打开，方便截图核对样式。
window.addEventListener('pet:demo-menu', () => {
  view.value = 'main';
  menuOpen.value = true;
});

// 桌面壳专属菜单项交给宿主处理（开登录窗 / 退出进程）。
function desktopAction(kind) {
  menuOpen.value = false;
  emit('desktop-action', kind);
}
const menuPos = ref({ x: 0, y: 0 });
const menuSize = ref({ w: 224, h: 300 });
const view = ref('main');
const downloadRoot = import.meta.env.DEV
  ? 'https://zjshuzhi.cn:7936/downloads/desktop-pet/'
  : `${import.meta.env.BASE_URL}downloads/desktop-pet/`;
const petPackages = typeof __SZKJ_PET_DOWNLOADS__ === 'undefined'
  ? (import.meta.env.DEV ? { mac: 'SZKJ-Pet-macOS-arm64.zip' } : {})
  : __SZKJ_PET_DOWNLOADS__;
const desktopDownloads = [
  { label: 'macOS（Apple 芯片）', file: petPackages.mac },
  { label: 'Windows（64 位）', file: petPackages.windows },
].map(({ label, file }) => ({ label, href: file ? downloadRoot + file : '' }));
if (/^Win/i.test(window.navigator.userAgentData?.platform || window.navigator.platform)) {
  desktopDownloads.reverse();
}

let behavior = null;
let outsidePointerDown = null;

// 气泡：显示最近一条平台消息，约 6 秒后自动收起；点一下即跳转并收起。
const BUBBLE_W = 200;
const BUBBLE_GAP = 2;
// 舞台构图里猫耳上沿距盒子顶部约 68px（原 360×368 比例），按缩放换算。
const BUBBLE_HEAD_INSET = 68;
const DESKTOP_BOTTOM = 34;
const DESKTOP_BUBBLE_SPACE = 136;
const NOTICE_WIDTH = 236;
const BUBBLE_VISIBLE_MS = 10000;
const bubble = ref(null);
const bubbleAnchor = ref({ left: 0, top: 0, w: 0, h: 0 });
let bubbleTimer = null;

const MIN_SIZE = 10;
const MAX_SIZE = 100;
// 舞台按固定 360×368 构图，缩放通过 transform 完成。挂件外层盒子同步为缩放后的尺寸，
// 让「定位边界」和「视觉边界」完全重合；否则盒子仍是未缩放的 360×368，
// 钳制按视觉尺寸算就会出现视觉区域被推出屏幕、默认位置显示不全的问题。
const STAGE_W = 360;
const STAGE_H = 368;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
const scale = computed(() => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(options.size) || 50)) / 100);
const boxW = computed(() => Math.round(STAGE_W * scale.value));
const boxH = computed(() => Math.round(STAGE_H * scale.value));

function clampPosition(x, y) {
  // innerWidth/innerHeight 是视觉像素，left/top 按布局像素解释；非 100% 界面缩放下先换算。
  const z = 1;
  return {
    x: Math.round(clamp(x, 0, Math.max(0, window.innerWidth / z - boxW.value))),
    y: Math.round(clamp(y, 0, Math.max(0, window.innerHeight / z - boxH.value))),
  };
}

/** 把已保存的位置收回到当前视口边界内（尺寸变化、窗口缩放、分辨率变化时都要做）。 */
function syncPositionBounds() {
  if (position.x == null || position.y == null) return;
  const next = clampPosition(position.x, position.y);
  if (next.x !== position.x || next.y !== position.y) setPosition(next.x, next.y);
}

const wrapStyle = computed(() => {
  const style = { width: `${boxW.value}px`, height: `${boxH.value}px` };
  if (props.desktop) {
    // 桌面版位置完全由窗口决定：盒子贴住窗口右下角，只有 12px 呼吸位。
    // 不能依赖 style.css 里的 html[data-szkj-pet-shell] 覆盖——壳里根本没加载全局样式，
    // 落回 .pet-widget 默认的 bottom:72px 会让盒子高出窗口上沿，缩到中/小就切耳朵。
    Object.assign(style, {
      left: 'auto',
      top: 'auto',
      right: '16px',
      // 26px 下方留白专门放状态条，猫本体不再贴屏幕底
      bottom: `${DESKTOP_BOTTOM}px`,
      '--pet-scale': String(scale.value),
    });
    return style;
  }
  // 网页版保留页面内拖动坐标。
  if (position.x != null && position.y != null) {
    style.left = `${position.x}px`;
    style.top = `${position.y}px`;
    style.right = 'auto';
    style.bottom = 'auto';
  }
  return style;
});

const stageStyle = computed(() => ({
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}));

const menuStyle = computed(() => {
  const z = 1;
  const { w, h } = menuSize.value;
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  // 指针坐标是视觉像素，菜单用 fixed + left/top 定位按布局像素解释，需除以缩放系数。
  const px = menuPos.value.x / z;
  const py = menuPos.value.y / z;
  let left = px;
  let top = py;
  // 靠近右/下边缘时像原生右键菜单一样向左/向上翻转。
  if (left + w > vw - 8) left = px - w;
  if (top + h > vh - 8) top = py - h;
  left = clamp(left, 0, Math.max(0, vw - w));
  top = clamp(top, 0, Math.max(0, vh - h));
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
});

// 气泡贴着挂件盒子摆放：优先在上方，上方空间不够就翻到下方；
// 水平方向以盒子中心对齐（猫在舞台里居中，右对齐会让气泡整体偏出），
// 再用视口边界夹住。全部按布局像素算，兼容界面缩放。
const currentAnchor = computed(() => (
  (position.x != null && position.y != null)
    ? { left: position.x, top: position.y, w: boxW.value, h: boxH.value }
    : bubbleAnchor.value
));

const desktopBubbleBottom = computed(() =>
  Math.round(DESKTOP_BOTTOM + boxH.value - BUBBLE_HEAD_INSET * scale.value + BUBBLE_GAP),
);

function desktopPopupStyle(width) {
  return {
    left: `${Math.max(8, Math.round(window.innerWidth - 16 - (boxW.value + width) / 2))}px`,
    bottom: `${desktopBubbleBottom.value}px`,
    width: `${width}px`,
  };
}

const bubbleStyle = computed(() => {
  if (!bubble.value) return {};
  if (props.desktop) return desktopPopupStyle(BUBBLE_W);
  const z = 1;
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const anchor = currentAnchor.value;
  const left = clamp(anchor.left + anchor.w / 2 - BUBBLE_W / 2, 8, Math.max(8, vw - BUBBLE_W - 8));
  // 舞台顶部到猫耳有一截留白（约 68/368 的构图高度），从盒子顶部起算会让气泡悬空很高，
  // 所以上方贴住耳朵上沿而不是盒子顶沿。
  const headTop = anchor.top + BUBBLE_HEAD_INSET * scale.value;
  const style = { left: `${Math.round(left)}px`, width: `${BUBBLE_W}px` };
  const above = headTop;
  const below = vh - (anchor.top + anchor.h);
  if (above >= 88 || above > below) style.bottom = `${Math.round(vh - headTop + BUBBLE_GAP)}px`;
  else style.top = `${Math.round(anchor.top + anchor.h + BUBBLE_GAP)}px`;
  return style;
});

// 提示气泡与消息气泡同一套贴耳摆放规则，宽度略宽以容纳按钮。
const noticeStyle = computed(() => {
  if (!props.notice) return {};
  if (props.desktop) return desktopPopupStyle(NOTICE_WIDTH);
  const z = 1;
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const anchor = currentAnchor.value;
  const width = NOTICE_WIDTH;
  const left = clamp(anchor.left + anchor.w / 2 - width / 2, 8, Math.max(8, vw - width - 8));
  const headTop = anchor.top + BUBBLE_HEAD_INSET * scale.value;
  const style = { left: `${Math.round(left)}px`, width: `${width}px` };
  const above = headTop;
  const below = vh - (anchor.top + anchor.h);
  if (above >= 120 || above > below) style.bottom = `${Math.round(vh - headTop + BUBBLE_GAP)}px`;
  else style.top = `${Math.round(anchor.top + anchor.h + BUBBLE_GAP)}px`;
  return style;
});

function measureBubbleAnchor() {
  if (props.desktop) return;
  const w = boxW.value;
  const h = boxH.value;
  // 有保存位置时直接按坐标算，拖动过程中每帧都准确；默认右下角定位时只能靠实际矩形。
  if (position.x != null && position.y != null) {
    bubbleAnchor.value = { left: position.x, top: position.y, w, h };
    return;
  }
  const el = wrapRef.value;
  if (!el) return;
  const z = 1;
  const rect = el.getBoundingClientRect();
  bubbleAnchor.value = { left: rect.left / z, top: rect.top / z, w: rect.width / z, h: rect.height / z };
}

// 桌面版几何自检：窗口高度、猫盒子、舞台、画布真实尺寸一次打出来。
function dumpPetGeometry(tag) {
  if (!props.desktop || typeof window.__szkjPetLog !== 'function') return;
  const wrap = wrapRef.value?.getBoundingClientRect();
  const stage = stageRef.value?.getBoundingClientRect();
  const canvas = stageRef.value?.querySelector('canvas');
  const canvasSize = canvas ? `${canvas.clientWidth}x${canvas.clientHeight}/${canvas.width}x${canvas.height}` : 'null';
  window.__szkjPetLog(
    `[geo] ${tag} win=${window.innerWidth}x${window.innerHeight} box=${boxW.value}x${boxH.value}`
    + ` wrap=${wrap ? `${Math.round(wrap.left)},${Math.round(wrap.top)} ${Math.round(wrap.width)}x${Math.round(wrap.height)}` : 'null'}`
    + ` stage=${stage ? `${Math.round(stage.width)}x${Math.round(stage.height)}` : 'null'}`
    + ` canvas=${canvasSize} scale=${scale.value}`,
  );
}

// 桌面窗口预留气泡空间，消息进出时不触发原生窗口和画布 resize。
function requestDesktopWindowFit() {
  if (!props.desktop) return;
  window.__szkjPetFitHeight?.(desktopBubbleBottom.value + DESKTOP_BUBBLE_SPACE);
}

function hideBubble() {
  bubble.value = null;
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
}

// 桌面版把「猫 + 气泡」的合并矩形上报给宿主，宿主据此判断是否让窗口接收鼠标；
// 不报的话窗口要么整块吞点击，要么整块穿透导致点不到猫。
function syncDesktopHitRect() {
  if (!props.desktop || typeof window.__szkjPetSyncHitRect !== 'function') return;
  const wrap = wrapRef.value?.getBoundingClientRect();
  if (!wrap) return;
  // 菜单展开时整个窗口都接收点击：菜单尺寸随缩放变化，逐块量容易漏，
  // 而且关菜单本来就是一次全窗口的点击。
  if (menuOpen.value) {
    window.__szkjPetSyncHitRect?.({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    return;
  }

  const parts = [wrap];
  const bubbleRect = bubbleRef.value?.getBoundingClientRect();
  if (bubbleRect) parts.push(bubbleRect);
  const noticeRect = noticeRef.value?.getBoundingClientRect();
  if (noticeRect) parts.push(noticeRect);
  // 菜单开着时把菜单并进命中区域，否则菜单项点不到。
  const menuRect = menuRef.value?.getBoundingClientRect();
  if (menuRect) parts.push(menuRect);
  // 右下角状态条同样要可点：点它就是打开平台。
  const statusRect = statusRef.value?.getBoundingClientRect();
  if (statusRect) parts.push(statusRect);
  const left = Math.min(...parts.map((r) => r.left));
  const top = Math.min(...parts.map((r) => r.top));
  const right = Math.max(...parts.map((r) => r.right));
  const bottom = Math.max(...parts.map((r) => r.bottom));
  window.__szkjPetSyncHitRect({ x: left, y: top, width: right - left, height: bottom - top });
}

function showBubble(message) {
  if (!enabled.value || !message) return;
  // 先量盒子再显示，避免用上一帧或零尺寸锚点算出一个跳动的位置。
  measureBubbleAnchor();
  bubble.value = message;
  nextTick(measureBubbleAnchor);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, BUBBLE_VISIBLE_MS);
}

function onBubbleClick() {
  const message = bubble.value;
  hideBubble();
  if (!message || !message.open) return;
  const detail = message.open.kind === 'employee-chat' ? message.open.detail : null;
  if (window.__TAURI_INTERNALS__) {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_platform', {
        conversationId: detail?.conversationId || null,
        contactId: detail?.contactId || null,
        notifications: !detail,
      }))
      .catch((error) => console.warn('[pet] open platform failed', error));
    return;
  }
  if (detail) {
    window.dispatchEvent(new CustomEvent('szkj:open-employee-chat-conversation', { detail }));
    return;
  }
  window.__szkjOpenNotificationCenter = true;
  window.dispatchEvent(new Event('szkj:open-notification-center'));
}

function onPetMessage(event) {
  const detail = event?.detail;
  if (!detail) return;
  showBubble(detail);
}

function openMenu(event) {
  menuPos.value = { x: event.clientX, y: event.clientY };
  view.value = 'main';
  menuOpen.value = true;
  measureMenu();
}

function measureMenu() {
  nextTick(() => {
    if (menuRef.value) {
      menuSize.value = { w: menuRef.value.offsetWidth, h: menuRef.value.offsetHeight };
    }
  });
}

function hideWidget() {
  menuOpen.value = false;
  if (props.desktop) emit('desktop-action', 'hide');
  else toggleVisible();
}

function resetPosition() {
  clearPosition();
  menuOpen.value = false;
  // 桌面壳的窗口位置由宿主管理，清掉本地坐标还得让窗口真的回到右下角。
  if (props.desktop) emit('desktop-action', 'reset');
}

let dragStart = null;

function onStagePointerDown(event) {
  if (event.button === 2) return;
  if (event.target.closest('.pet-menu')) return;
  event.preventDefault();
  // 桌面版拖动整个窗口，由宿主注入的钩子接管（Tauri startDragging）。
  if (props.desktop && typeof window.__szkjPetDesktopDrag === 'function') {
    window.__szkjPetDesktopDrag();
    return;
  }
  const rect = wrapRef.value.getBoundingClientRect();
  const z = 1;
  dragStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    originLeft: position.x ?? rect.left / z,
    originTop: position.y ?? rect.top / z,
    moved: false,
  };
  try {
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  } catch {
    // 合成事件或指针已失效时忽略，拖动仍靠 window 监听兜底。
  }
  // 捕获阶段监听：即便内部元素 stopPropagation，window 也能先收到移动/抬起事件。
  window.addEventListener('pointermove', onDragMove, true);
  window.addEventListener('pointerup', onDragEnd, true);
  window.addEventListener('pointercancel', onDragEnd, true);
}

function onDragMove(event) {
  if (!dragStart) return;
  const z = 1;
  const dx = (event.clientX - dragStart.clientX) / z;
  const dy = (event.clientY - dragStart.clientY) / z;
  if (!dragStart.moved && Math.hypot(dx, dy) < 4) return;
  dragStart.moved = true;
  const next = clampPosition(dragStart.originLeft + dx, dragStart.originTop + dy);
  setPosition(next.x, next.y);
  // 气泡跟随拖动：位置每次变化后立刻重算锚点，不能等 pointerup。
  if (bubble.value) measureBubbleAnchor();
}

function onDragEnd() {
  const pointerId = dragStart?.pointerId;
  dragStart = null;
  try {
    stageRef.value?.releasePointerCapture?.(pointerId);
  } catch {
    // 指针已被系统回收时忽略。
  }
  window.removeEventListener('pointermove', onDragMove, true);
  window.removeEventListener('pointerup', onDragEnd, true);
  window.removeEventListener('pointercancel', onDragEnd, true);
  if (bubble.value) measureBubbleAnchor();
}

function createScene() {
  if (!stageRef.value || behavior) return;
  mountCore(stageRef.value);
  initKeyboard();
  initFur();
  initCat();
  behavior = createBehavior();
  behavior.cat.options({ ...look, tune: { ...tune }, privacy: options.privacy, sleepAfter: options.sleepAfter });
}

function destroyScene() {
  if (behavior) {
    behavior.destroy();
    behavior = null;
  }
  unmountCore();
}

function syncToScene() {
  if (!behavior) return;
  behavior.cat.options({ ...look });
  behavior.cat.options({ tune: { ...tune } });
  behavior.cat.options({ privacy: options.privacy, sleepAfter: options.sleepAfter });
}

onMounted(() => {
  if (props.desktop) {
    setTimeout(() => dumpPetGeometry('mount'), 800);
    setTimeout(() => dumpPetGeometry('later'), 2000);
  }
  // 先按当前视口校正一次已保存的位置，避免换分辨率/换缩放后位置越界导致显示不全。
  syncPositionBounds();
  if (enabled.value) createScene();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('pet:desktop-input', onDesktopInput);
  window.addEventListener('resize', syncPositionBounds);
  window.addEventListener(PET_MESSAGE_EVENT, onPetMessage);
  window.addEventListener('resize', measureBubbleAnchor);
  window.addEventListener('resize', syncDesktopHitRect);
  syncDesktopHitRect();
  window.addEventListener('pet:bridge-ready', requestDesktopWindowFit, { once: true });
  requestDesktopWindowFit();
});

// 缩放改变会改变盒子尺寸，已保存的位置必须同步收回到边界内。
watch(scale, () => {
  syncPositionBounds();
  requestDesktopWindowFit();
  nextTick(() => setTimeout(() => dumpPetGeometry('scale'), 300));
});

// 气泡变化只更新鼠标命中矩形。
watch(
  () => [position.x, position.y, scale.value, bubble.value, props.notice, menuOpen.value],
  () => nextTick(() => {
    syncDesktopHitRect();
  }),
);

watch(enabled, next => {
  if (next) {
    syncPositionBounds();
    nextTick(() => {
      createScene();
      syncDesktopHitRect();
    });
  } else if (behavior) {
    destroyScene();
  }
});

watch(look, () => syncToScene(), { deep: true });
watch(tune, () => syncToScene(), { deep: true });
watch(options, () => syncToScene(), { deep: true });
watch(view, measureMenu);

watch(menuOpen, open => {
  if (outsidePointerDown) {
    document.removeEventListener('pointerdown', outsidePointerDown, true);
    outsidePointerDown = null;
  }
  if (open) {
    outsidePointerDown = event => {
      if (menuRef.value && menuRef.value.contains(event.target)) return;
      menuOpen.value = false;
    };
    document.addEventListener('pointerdown', outsidePointerDown, true);
  }
  if (open) menuOpenedAt = Date.now();
  // 菜单开合会改变命中区域：开时整窗可点，关时收回猫身。
  nextTick(syncDesktopHitRect);
});

function onKeydown(event) {
  if (event.key === 'Escape') menuOpen.value = false;
}

// 桌面壳里页面拿不到系统键盘/鼠标（窗口不抢焦点），宿主把全局输入转发成
// pet:desktop-input；这里直接喂给场景，不再合成 DOM 事件（合成事件的 key/code
// 与真实派发路径不同，之前键盘没反应就是这个原因）。
function onDesktopInput(event) {
  const payload = event?.detail;
  if (payload?.kind !== 'mousemove') {
    window.__szkjPetLog?.(`ui ${payload?.kind} ${payload?.code || ''} scene=${Boolean(behavior)}`);
  }
  if (!payload || !behavior) return;
  if (payload.kind === 'keydown') {
    const code = String(payload.code || '');
    // 全局 tap 偶尔会漏掉 keyup，场景里那个键就会一直停在按下状态、之后整键失效。
    // 每次按下先补一次抬起，把残留状态清掉。
    behavior.cat.key(code, false);
    behavior.cat.key(code, true);
    return;
  }
  if (payload.kind === 'keyup') {
    behavior.cat.key(String(payload.code || ''), false);
    return;
  }
  if (payload.kind === 'mousemove') {
    const x = Number(payload.x) || 0;
    const y = Number(payload.y) || 0;
    behavior.cat.cursor(x, y);
    behavior.cat.mouseMove(Number(payload.dx) || 0, Number(payload.dy) || 0);
  }
}

onBeforeUnmount(() => {
  if (outsidePointerDown) document.removeEventListener('pointerdown', outsidePointerDown, true);
  hideBubble();
  window.removeEventListener(PET_MESSAGE_EVENT, onPetMessage);
  window.removeEventListener('resize', measureBubbleAnchor);
  window.removeEventListener('resize', syncDesktopHitRect);
  window.removeEventListener('pet:bridge-ready', requestDesktopWindowFit);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pet:desktop-input', onDesktopInput);
  window.removeEventListener('resize', syncPositionBounds);
  window.removeEventListener('pointermove', onDragMove, true);
  window.removeEventListener('pointerup', onDragEnd, true);
  window.removeEventListener('pointercancel', onDragEnd, true);
  destroyScene();
});
</script>

<style scoped>
.pet-widget {
  position: fixed;
  right: 16px;
  bottom: 72px;
  z-index: 1100;
  pointer-events: none;
}

/* 桌面壳的窗口高度由「猫 + 气泡」实际需要决定：底部贴边只留 12px，
   否则猫在窗口里悬空，拖到屏幕上沿时指针先撞到菜单栏，看着就像撞了一条看不见的线。 */
:global(html[data-szkj-pet-shell='tauri']) .pet-widget {
  right: 16px;
  bottom: 12px;
}

/* 舞台保持 360×368 构图，按左上角缩放；外层盒子尺寸由 wrapStyle 同步为缩放后的尺寸，
   两者一致才能让拖动钳制与视觉边界重合，任何缩放下都不会被屏幕边缘切掉。 */
.pet-widget__stage {
  position: absolute;
  left: 0;
  top: 0;
  width: 360px;
  height: 368px;
  pointer-events: auto;
  touch-action: none;
}

.pet-widget__stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* 气泡固定宽度、不随挂件缩放，保证文字可读；位置由 bubbleStyle 计算，贴住盒子并避开屏幕边缘。 */
.pet-bubble {
  position: fixed;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--szkj-border-subtle, rgba(0, 0, 0, 0.08));
  background: var(--szkj-surface, #fff);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
  color: var(--szkj-text-regular, #334155);
  pointer-events: auto;
  cursor: pointer;
  z-index: 1101;
}

.pet-bubble__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
  min-width: 0;
}

.pet-bubble__label {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--szkj-accent, #2563eb);
}

.pet-bubble__title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--szkj-text-muted, #64748b);
}

.pet-bubble__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--szkj-text-primary, #1e293b);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/* 提示气泡：同时容纳说明和两个操作按钮，不抢猫的点击区域。 */
.pet-notice {
  cursor: default;
}

.pet-notice__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.pet-notice__button {
  padding: 4px 10px;
  border: 1px solid var(--szkj-border, #e2e8f0);
  border-radius: 8px;
  background: var(--szkj-surface, #fff);
  color: var(--szkj-text-regular, #475569);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.pet-notice__button.is-primary {
  border-color: transparent;
  background: var(--szkj-accent, #2563eb);
  color: #fff;
}

.pet-notice__button:hover {
  filter: brightness(0.96);
}

.pet-bubble-enter-active,
.pet-bubble-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pet-bubble-enter-from,
.pet-bubble-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.pet-desktop-bubble-enter-active {
  transition: opacity 100ms cubic-bezier(0.2, 0.75, 0.25, 1);
}

.pet-desktop-bubble-leave-active {
  transition: opacity 80ms linear;
  pointer-events: none;
}

.pet-desktop-bubble-enter-from,
.pet-desktop-bubble-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pet-bubble-enter-from,
  .pet-bubble-leave-to {
    transform: none;
  }
}

.pet-menu {
  position: fixed;
  width: 224px;
  padding: 6px;
  border: 1px solid var(--szkj-border, #e5e7eb);
  border-radius: 12px;
  background: var(--szkj-surface, #ffffff);
  color: var(--szkj-text-regular, #475569);
  box-shadow: var(--szkj-shadow, 0 8px 24px rgba(15,23,42,.18));
  pointer-events: auto;
  user-select: none;
  font-size: 13px;
}

.pet-menu__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pet-menu__download {
  box-sizing: border-box;
  text-decoration: none;
}

.pet-menu__row:disabled {
  cursor: default;
  opacity: 0.65;
}

.pet-menu__row:not(:disabled):hover {
  background: var(--szkj-surface-muted, #f1f5f9);
}

.pet-menu__row.is-on {
  background: var(--szkj-accent, #2563eb);
  color: var(--szkj-text-inverse, #ffffff);
}

.pet-menu__row.is-on:hover {
  background: var(--szkj-accent, #2563eb);
}

.pet-menu__chev {
  color: var(--szkj-text-faint, #94a3b8);
}

.pet-menu__mark {
  min-width: 16px;
  text-align: right;
  font-weight: 600;
}

.pet-menu__back {
  color: var(--szkj-text-muted, #64748b);
}

.pet-menu__sep {
  height: 1px;
  margin: 6px 4px;
  background: var(--szkj-border-subtle, #eef2f7);
}

.pet-menu__field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  font-size: 13px;
}

.pet-menu__field select {
  min-width: 108px;
  padding: 5px 8px;
  border: 1px solid var(--szkj-border, #e5e7eb);
  border-radius: 7px;
  background: var(--szkj-surface-muted, #f1f5f9);
  color: var(--szkj-text-strong, #0f172a);
  font: inherit;
}

.pet-menu__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  font-size: 13px;
}

.pet-menu__toggle input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--szkj-accent, #2563eb);
}

.pet-menu__group {
  padding: 4px 0;
}

.pet-menu__slider {
  padding: 6px 10px;
}

.pet-menu__slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 13px;
}

.pet-menu__value {
  font-variant-numeric: tabular-nums;
  color: var(--szkj-accent, #2563eb);
  font-weight: 600;
}

.pet-menu__slider input[type='range'] {
  width: 100%;
  height: 4px;
  accent-color: var(--szkj-accent, #2563eb);
}

.pet-menu__slider input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--szkj-accent, #2563eb);
}

.pet-menu-enter-active,
.pet-menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.pet-menu-enter-from,
.pet-menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
/* 桌面版状态条：账号名 + 连通指示灯，挂在键盘正下方居中。点它打开平台。 */
.pet-status {
  position: absolute;
  left: 54%;
  /* 顶边钉在键盘下沿（画布底部内侧 9px），缩放从顶边向下收，任何尺寸都紧贴键盘 */
  transform: translateX(-50%) scale(clamp(0.78, var(--pet-scale, 1), 1));
  transform-origin: 50% 0;
  top: calc(100% - 9px);
  z-index: 1102;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.12);
  color: #475569;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  max-width: 200px;
  pointer-events: auto;
  cursor: pointer;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.pet-status__name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pet-status__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: #94a3b8;
}

.pet-status--online .pet-status__dot { background: #22c55e; }
.pet-status--error .pet-status__dot { background: #ef4444; }
</style>
