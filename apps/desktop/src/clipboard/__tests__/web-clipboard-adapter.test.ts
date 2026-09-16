// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebClipboardAdapter } from '../web-clipboard-adapter';

describe('WebClipboardAdapter', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    readText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writeText() delegates to navigator.clipboard.writeText()', async () => {
    const adapter = new WebClipboardAdapter();
    await adapter.writeText('a real secret');
    expect(writeText).toHaveBeenCalledWith('a real secret');
  });

  it('readText() returns the real value when the clipboard is readable', async () => {
    readText.mockResolvedValue('a real secret');
    const adapter = new WebClipboardAdapter();
    expect(await adapter.readText()).toBe('a real secret');
  });

  it('readText() returns null (never throws) when the browser refuses -- e.g. no document focus', async () => {
    readText.mockRejectedValue(new Error('Document is not focused.'));
    const adapter = new WebClipboardAdapter();
    expect(await adapter.readText()).toBeNull();
  });

  it('clear() overwrites the clipboard with an empty string -- no real "clear" primitive on Web', async () => {
    const adapter = new WebClipboardAdapter();
    await adapter.clear();
    expect(writeText).toHaveBeenCalledWith('');
  });
});
