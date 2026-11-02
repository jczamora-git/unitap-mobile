import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetScrollPosition } from '@/utilities/scroll';

describe('resetScrollPosition utility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.scrollTo = vi.fn();
    document.documentElement.scrollTop = 500;
    document.body.scrollTop = 300;
  });

  it('resets window, documentElement and body scroll to top', () => {
    resetScrollPosition();

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });

  it('calls scrollToTop(0) and resets scroll element on all ion-content elements', async () => {
    const mockContent1 = document.createElement('ion-content');
    const mockContent2 = document.createElement('ion-content');

    const scrollToTop1 = vi.fn();
    const scrollToTop2 = vi.fn();

    const mockScrollElement1 = { scrollTop: 250 };
    const mockScrollElement2 = { scrollTop: 400 };

    (mockContent1 as any).scrollToTop = scrollToTop1;
    (mockContent1 as any).getScrollElement = vi.fn().mockResolvedValue(mockScrollElement1);

    (mockContent2 as any).scrollToTop = scrollToTop2;
    (mockContent2 as any).getScrollElement = vi.fn().mockResolvedValue(mockScrollElement2);

    document.body.appendChild(mockContent1);
    document.body.appendChild(mockContent2);

    resetScrollPosition();

    expect(scrollToTop1).toHaveBeenCalledWith(0);
    expect(scrollToTop2).toHaveBeenCalledWith(0);

    // Wait for getScrollElement promise resolution
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(mockScrollElement1.scrollTop).toBe(0);
    expect(mockScrollElement2.scrollTop).toBe(0);
  });
});

