import { computed, ref } from 'vue';
import { useEmployeeNormalChatRealtime } from '../composables/useEmployeeNormalChatRealtime.js';
import {
  connectPersonalCenterRealtime,
  disconnectPersonalCenterRealtime,
  loadPersonalCenterNotifications,
  onPersonalCenterNotification,
  usePersonalCenterRealtime,
} from '../composables/usePersonalCenterRealtime.js';
import { pushPetMessage } from '../utils/petMessageBus.js';
import { createPetMessageDelivery } from './messageDelivery.js';

export function useDesktopRealtime() {
  const personal = usePersonalCenterRealtime();
  const snapshotAvailable = ref(false);
  let session = null;
  let stopNotifications = null;
  let snapshotTimer = null;
  const chat = useEmployeeNormalChatRealtime({
    onMessage: (event) => session?.chat(event),
    trackVisibility: false,
  });
  const connected = computed(() =>
    chat.status.value === 'connected' || personal.isPersonalCenterRealtimeConnected.value || snapshotAvailable.value,
  );

  function stop() {
    session = null;
    snapshotAvailable.value = false;
    stopNotifications?.();
    stopNotifications = null;
    clearInterval(snapshotTimer);
    snapshotTimer = null;
    chat.close();
    disconnectPersonalCenterRealtime({ clearState: true });
  }

  function start(userIds) {
    stop();
    const current = createPetMessageDelivery({ userIds, openedAt: Date.now(), show: pushPetMessage });
    session = current;
    stopNotifications = onPersonalCenterNotification(current.notification);

    let loadingSnapshot = false;
    async function readSnapshot() {
      if (session !== current || loadingSnapshot || personal.isPersonalCenterRealtimeConnected.value) return;
      loadingSnapshot = true;
      try {
        const items = await loadPersonalCenterNotifications();
        if (session === current) {
          snapshotAvailable.value = true;
          for (const item of items.slice().reverse()) current.notification(item, { snapshot: true });
        }
      } catch {
        if (session === current) snapshotAvailable.value = false;
      } finally {
        loadingSnapshot = false;
      }
    }

    snapshotTimer = setInterval(readSnapshot, 20000);
    void chat.connect().catch(() => {});
    void connectPersonalCenterRealtime()
      .then((socket) => { if (!socket) return readSnapshot(); })
      .catch(readSnapshot);
  }

  return { start, stop, connected };
}
