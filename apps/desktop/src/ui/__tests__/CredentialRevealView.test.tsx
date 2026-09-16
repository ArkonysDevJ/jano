// @vitest-environment jsdom
/**
 * Component test against a REAL `EngineClient`/Worker (real Argon2id
 * + AES-GCM) -- only the `ClipboardAdapter` is a simple fake here,
 * since the clipboard adapters and `scheduleClipboardAutoClear` each
 * already have their own dedicated tests (clipboard/__tests__/); this
 * file's job is CredentialRevealView's own reveal/mask/blur/copy
 * logic, not re-proving those.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CredentialRevealView } from '../CredentialRevealView';
import { EngineClient } from '../../worker';
import { serializeVaultItem, deserializeVaultItem } from '../../engine/vault-item';
import { VAULT_ITEM_SCHEMA_VERSION } from '../../engine/types';
import type { ClipboardAdapter } from '../../clipboard';

function fakeClipboardAdapter(): ClipboardAdapter {
  return {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(null),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

async function seedRevealPassword(plaintextPassword: string) {
  const client = new EngineClient();
  await client.createNewVault('the real master password');
  const ciphertext = await client.encryptItem(
    serializeVaultItem({
      schemaVersion: VAULT_ITEM_SCHEMA_VERSION,
      title: 't',
      username: 'u',
      password: plaintextPassword,
    }),
  );
  const revealPassword = async () => {
    const plaintext = await client.decryptItem(ciphertext);
    return deserializeVaultItem(plaintext).password;
  };
  return { client, revealPassword };
}

describe('CredentialRevealView', () => {
  afterEach(() => {
    cleanup();
  });

  it('reveals a real decrypted password on demand', async () => {
    const { client, revealPassword } = await seedRevealPassword('the real decrypted password');
    try {
      render(<CredentialRevealView title="t" username="u" revealPassword={revealPassword} clipboardAdapter={fakeClipboardAdapter()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));
      await screen.findByText('the real decrypted password');
    } finally {
      client.terminate();
    }
  });

  it('destroys the revealed node from the DOM on blur, not just visually', async () => {
    const { client, revealPassword } = await seedRevealPassword('the real decrypted password');
    try {
      render(<CredentialRevealView title="t" username="u" revealPassword={revealPassword} clipboardAdapter={fakeClipboardAdapter()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));
      await screen.findByText('the real decrypted password');

      fireEvent.blur(screen.getByRole('button', { name: 'Hide' }), { relatedTarget: document.body });

      expect(screen.queryByText('the real decrypted password')).toBeNull();
      screen.getByRole('button', { name: 'Reveal password' }); // throws if it's not back -- that's the assertion
    } finally {
      client.terminate();
    }
  });

  it('auto-masks on its own after the configured timeout while still focused', async () => {
    // A real 10s UI_AUTO_MASK_TIMEOUT_MS doesn't mix reliably with
    // Testing Library's polling-based findBy*/waitFor under
    // vi.useFakeTimers() -- tried that first, and advancing the fake
    // clock past the timeout did not make the already-scheduled
    // setTimeout fire (a real interaction problem between the two,
    // not this component's own logic). Overriding autoMaskTimeoutMs
    // to a few real milliseconds exercises the exact same code path
    // without fighting that interaction.
    const { client, revealPassword } = await seedRevealPassword('the real decrypted password');
    try {
      render(
        <CredentialRevealView
          title="t"
          username="u"
          revealPassword={revealPassword}
          clipboardAdapter={fakeClipboardAdapter()}
          autoMaskTimeoutMs={30}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));
      await screen.findByText('the real decrypted password');

      await waitFor(() => {
        expect(screen.queryByText('the real decrypted password')).toBeNull();
      });
    } finally {
      client.terminate();
    }
  });

  it('copying writes the real password to the clipboard and shows a text confirmation (not color-only)', async () => {
    const { client, revealPassword } = await seedRevealPassword('the real decrypted password');
    const clipboardAdapter = fakeClipboardAdapter();
    try {
      render(<CredentialRevealView title="t" username="u" revealPassword={revealPassword} clipboardAdapter={clipboardAdapter} />);
      fireEvent.click(screen.getByRole('button', { name: 'Reveal password' }));
      await screen.findByText('the real decrypted password');

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      const confirmedText = await screen.findByText(/\[COPIED\] Copied to clipboard\./);
      expect(clipboardAdapter.writeText).toHaveBeenCalledWith('the real decrypted password');

      // The functional hook Fase 2's checklist (section 4) will style as a
      // 1px->2px border change -- confirming it's real state, not just text.
      const confirmedContainer = confirmedText.closest('p');
      expect(confirmedContainer).not.toBeNull();
      expect(confirmedContainer?.getAttribute('data-copy-confirmed')).toBe('true');
    } finally {
      client.terminate();
    }
  });
});
