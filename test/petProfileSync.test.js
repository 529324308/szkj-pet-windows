// 桌宠账号级配置同步：账号隔离、服务端较新覆盖、服务端为空时反向推送。
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const { bindPetAccount, unbindPetAccount, usePetWidgetState } = await import(
  '../src/components/pet/petWidgetState.js'
);
const pet = usePetWidgetState();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('账号首次绑定：服务端为空时把本机配置推上去', async () => {
  const saves = [];
  await bindPetAccount({
    userId: 'user-a',
    load: async () => ({ profile: null, updatedAt: null }),
    save: async (profile) => {
      saves.push(profile);
      return { updatedAt: '2026-11-25T07:00:00.000Z' };
    },
  });
  await sleep(50);
  assert.equal(saves.length, 1, '应把本机配置写回服务端');
  assert.ok(saves[0].look && saves[0].options, 'payload 应包含外观与行为');
});

test('账号隔离：换账号读到各自的缓存，不互相污染', async () => {
  pet.setLook({ coat: 'calico' });
  pet.setOption({ size: 40 });
  await sleep(50);
  const cacheA = JSON.parse(store.get('szkj:pet:account:user-a:profile'));
  assert.equal(cacheA.look.coat, 'calico');

  await bindPetAccount({
    userId: 'user-b',
    load: async () => ({ profile: null, updatedAt: null }),
    save: async () => ({ updatedAt: '2026-11-25T07:10:00.000Z' }),
  });
  // 新账号没有旧缓存时，不应直接继承 user-a 的毛色。
  assert.notEqual(
    JSON.parse(store.get('szkj:pet:account:user-b:profile')).look.coat,
    'calico',
  );
});

test('服务端较新：覆盖本机缓存', async () => {
  await bindPetAccount({
    userId: 'user-b',
    load: async () => ({
      profile: {
        version: 1,
        updatedAt: '2026-11-25T08:00:00.000Z',
        look: { coat: 'white' },
        options: { size: 100 },
      },
      updatedAt: '2026-11-25T08:00:00.000Z',
    }),
    save: async () => ({ updatedAt: '2026-11-25T08:00:00.000Z' }),
  });
  assert.equal(pet.look.coat, 'white');
  assert.equal(pet.options.size, 100);
});

test('解绑账号：回到匿名配置，不再写云端', async () => {
  unbindPetAccount();
  assert.equal(pet.getAccountId(), '');
});
