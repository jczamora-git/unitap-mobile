/**
 * Scroll Utility for UniTap
 * Enforces scroll position reset to top (0) across Ionic pages, tabs, and content containers.
 */

export function resetScrollPosition(animated: boolean = false): void {
  if (typeof window === 'undefined') return;

  // 1. Reset standard browser window and document elements
  window.scrollTo({ top: 0, left: 0, behavior: animated ? 'smooth' : 'auto' });
  if (document.documentElement) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body) {
    document.body.scrollTop = 0;
  }

  // 2. Reset all Ionic <ion-content> components in the DOM
  const scrollIonContents = () => {
    try {
      const contents = document.querySelectorAll('ion-content');
      contents.forEach((content) => {
        try {
          if (typeof (content as any).scrollToTop === 'function') {
            (content as any).scrollToTop(animated ? 300 : 0);
          }
          if (typeof (content as any).getScrollElement === 'function') {
            (content as any).getScrollElement().then((el: HTMLElement | null) => {
              if (el && el.scrollTop !== 0) {
                el.scrollTop = 0;
              }
            }).catch(() => {});
          }
        } catch (_) {}
      });
    } catch (_) {}
  };

  scrollIonContents();
  requestAnimationFrame(scrollIonContents);
  setTimeout(scrollIonContents, 50);
  setTimeout(scrollIonContents, 150);
}

