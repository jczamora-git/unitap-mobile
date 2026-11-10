import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportFile } from '@/utilities/file-export';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn(),
  },
  Directory: {
    Cache: 'CACHE',
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn(),
  },
}));

describe('UniTap File Export Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports file via Web Blob anchor download when not on native platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    let createdLink: HTMLAnchorElement | null = null;
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        createdLink = el as HTMLAnchorElement;
        el.click = clickSpy;
      }
      return el;
    });

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    await exportFile({
      filename: 'test_report.csv',
      content: 'col1,col2\nval1,val2\n',
      mimeType: 'text/csv;charset=utf-8;',
    });

    expect(clickSpy).toHaveBeenCalled();
    expect(createdLink?.download).toBe('test_report.csv');
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
  });

  it('writes to native cache and invokes Share.share when on native platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Filesystem.writeFile).mockResolvedValue({
      uri: 'file:///data/user/0/com.unitap.app/cache/receipt_123.pdf',
    });
    vi.mocked(Share.share).mockResolvedValue({} as any);

    await exportFile({
      filename: 'receipt_123.pdf',
      content: new Uint8Array([37, 80, 68, 70]), // %PDF
      mimeType: 'application/pdf',
      dialogTitle: 'Download Receipt',
    });

    expect(Filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'receipt_123.pdf',
        directory: Directory.Cache,
      })
    );

    expect(Share.share).toHaveBeenCalledWith({
      title: 'receipt_123.pdf',
      text: 'receipt_123.pdf',
      url: 'file:///data/user/0/com.unitap.app/cache/receipt_123.pdf',
      dialogTitle: 'Download Receipt',
    });
  });

  it('handles user cancellation gracefully on native share', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Filesystem.writeFile).mockResolvedValue({
      uri: 'file:///cache/test.pdf',
    });
    vi.mocked(Share.share).mockRejectedValue(new Error('Share canceled by user'));

    // Should not throw
    await expect(
      exportFile({
        filename: 'test.pdf',
        content: 'content',
        mimeType: 'application/pdf',
      })
    ).resolves.not.toThrow();
  });
});

