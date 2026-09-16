import { beforeEach, describe, expect, it } from 'vitest';
import { VaultKeysService } from './vault-keys.service.js';
import { InMemoryVaultKeysRepository } from '../persistence/in-memory/in-memory-vault-keys.repository.js';

describe('VaultKeysService', () => {
  let service: VaultKeysService;
  const userId = 'user-1';

  beforeEach(() => {
    service = new VaultKeysService(new InMemoryVaultKeysRepository());
  });

  it('registers the master wrapping at key version 1', async () => {
    const wrapped = new TextEncoder().encode('wrapped-master-dek');
    const key = await service.upsert(userId, 'master', wrapped, 1);

    expect(key.purpose).toBe('master');
    expect(key.keyVersion).toBe(1);
    expect(new TextDecoder().decode(key.wrappedDek)).toBe('wrapped-master-dek');
  });

  it('registers master and recovery independently, with independent key versions (section 3)', async () => {
    await service.upsert(userId, 'master', new TextEncoder().encode('master-v1'), 1);
    await service.upsert(userId, 'recovery', new TextEncoder().encode('recovery-v1'), 1);

    // Master rotates -- recovery's version must not move (independent axes).
    await service.upsert(userId, 'master', new TextEncoder().encode('master-v2'), 2);

    const keys = await service.list(userId);
    expect(keys).toHaveLength(2);

    const master = keys.find((k) => k.purpose === 'master');
    const recovery = keys.find((k) => k.purpose === 'recovery');

    expect(master?.keyVersion).toBe(2);
    expect(new TextDecoder().decode(master!.wrappedDek)).toBe('master-v2');
    expect(recovery?.keyVersion).toBe(1);
    expect(new TextDecoder().decode(recovery!.wrappedDek)).toBe('recovery-v1');
  });

  it('isolates keys by user', async () => {
    await service.upsert(userId, 'master', new TextEncoder().encode('user-1-key'), 1);
    await service.upsert('user-2', 'master', new TextEncoder().encode('user-2-key'), 1);

    const keysForUser1 = await service.list(userId);
    expect(keysForUser1).toHaveLength(1);
    expect(new TextDecoder().decode(keysForUser1[0]!.wrappedDek)).toBe('user-1-key');
  });

  it('returns an empty list for a user with no registered keys yet', async () => {
    const keys = await service.list('nobody');
    expect(keys).toHaveLength(0);
  });
});
