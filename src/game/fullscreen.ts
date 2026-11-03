export interface FullscreenStateSnapshot {
  isFullscreen: boolean;
  mode: 'off' | 'native' | 'viewport';
  notice: string | null;
}

interface VendorDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

interface VendorElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

export function getNativeFullscreenElement(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): Element | null {
  if (!doc) return null;
  const vDoc = doc as VendorDocument;
  return (
    vDoc.fullscreenElement ??
    vDoc.webkitFullscreenElement ??
    vDoc.webkitCurrentFullScreenElement ??
    vDoc.mozFullScreenElement ??
    vDoc.msFullscreenElement ??
    null
  );
}

export function isNativeFullscreenApiAvailable(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
  target?: HTMLElement | null
): boolean {
  if (!doc) return false;
  const vDoc = doc as VendorDocument;
  const el = (target ?? doc.documentElement) as VendorElement | null;
  if (!el) return false;

  const hasMethod = Boolean(
    typeof el.requestFullscreen === 'function' ||
      typeof el.webkitRequestFullscreen === 'function' ||
      typeof el.mozRequestFullScreen === 'function' ||
      typeof el.msRequestFullscreen === 'function'
  );
  if (!hasMethod) return false;

  if (typeof vDoc.fullscreenEnabled === 'boolean') {
    return vDoc.fullscreenEnabled;
  }
  if (typeof vDoc.webkitFullscreenEnabled === 'boolean') {
    return vDoc.webkitFullscreenEnabled;
  }
  return true;
}

export async function requestNativeFullscreen(target: HTMLElement): Promise<void> {
  const vEl = target as VendorElement;
  if (typeof vEl.requestFullscreen === 'function') {
    try {
      await vEl.requestFullscreen({ navigationUI: 'hide' });
      return;
    } catch (firstErr) {
      // Retry without FullscreenOptions for browsers that reject options argument
      if (firstErr instanceof TypeError) {
        await vEl.requestFullscreen();
        return;
      }
      throw firstErr;
    }
  }
  if (typeof vEl.webkitRequestFullscreen === 'function') {
    await vEl.webkitRequestFullscreen();
    return;
  }
  if (typeof vEl.mozRequestFullScreen === 'function') {
    await vEl.mozRequestFullScreen();
    return;
  }
  if (typeof vEl.msRequestFullscreen === 'function') {
    await vEl.msRequestFullscreen();
    return;
  }
  throw new Error('Fullscreen API not supported');
}

export async function exitNativeFullscreen(doc: Document): Promise<void> {
  const vDoc = doc as VendorDocument;
  if (typeof vDoc.exitFullscreen === 'function') {
    await vDoc.exitFullscreen();
    return;
  }
  if (typeof vDoc.webkitExitFullscreen === 'function') {
    await vDoc.webkitExitFullscreen();
    return;
  }
  if (typeof vDoc.mozCancelFullScreen === 'function') {
    await vDoc.mozCancelFullScreen();
    return;
  }
  if (typeof vDoc.msExitFullscreen === 'function') {
    await vDoc.msExitFullscreen();
    return;
  }
}

export interface FullscreenEnvironmentAdapter {
  getNativeElement: () => Element | null;
  isNativeSupported: () => boolean;
  requestNative: () => Promise<void>;
  exitNative: () => Promise<void>;
}

/**
 * Coordinates native Fullscreen API (`requestFullscreen` / `exitFullscreen`),
 * vendor-prefixed events (`fullscreenchange` / `webkitfullscreenchange`),
 * and clean fallback error handling when fullscreen is unavailable or blocked.
 */
export class FullscreenController {
  private adapter: FullscreenEnvironmentAdapter;
  private viewportFallbackActive = false;
  private notice: string | null = null;
  private listeners = new Set<(snap: FullscreenStateSnapshot) => void>();

  constructor(adapter?: FullscreenEnvironmentAdapter, getTarget?: () => HTMLElement | null) {
    if (adapter) {
      this.adapter = adapter;
    } else {
      this.adapter = {
        getNativeElement: () => getNativeFullscreenElement(),
        isNativeSupported: () => {
          const el = getTarget?.() ?? (typeof document !== 'undefined' ? document.documentElement : null);
          return isNativeFullscreenApiAvailable(typeof document !== 'undefined' ? document : undefined, el);
        },
        requestNative: async () => {
          if (typeof document === 'undefined') throw new Error('No document');
          const el = getTarget?.() ?? document.documentElement;
          await requestNativeFullscreen(el);
        },
        exitNative: async () => {
          if (typeof document === 'undefined') return;
          await exitNativeFullscreen(document);
        },
      };
    }
  }

  public getSnapshot(): FullscreenStateSnapshot {
    const nativeActive = Boolean(this.adapter.getNativeElement());
    if (nativeActive) {
      return {
        isFullscreen: true,
        mode: 'native',
        notice: this.notice,
      };
    }
    if (this.viewportFallbackActive) {
      return {
        isFullscreen: true,
        mode: 'viewport',
        notice: this.notice,
      };
    }
    return {
      isFullscreen: false,
      mode: 'off',
      notice: this.notice,
    };
  }

  public subscribe(listener: (snap: FullscreenStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  public handleBrowserFullscreenChange(): void {
    const nativeActive = Boolean(this.adapter.getNativeElement());
    if (nativeActive) {
      this.viewportFallbackActive = false;
      this.notice = null;
    } else if (!this.viewportFallbackActive) {
      this.notice = null;
    }
    this.emit();
  }

  public clearNotice(): void {
    if (this.notice !== null) {
      this.notice = null;
      this.emit();
    }
  }

  public exitViewportFallbackIfActive(): boolean {
    if (!this.viewportFallbackActive) return false;
    this.viewportFallbackActive = false;
    this.notice = null;
    this.emit();
    return true;
  }

  public async toggle(): Promise<FullscreenStateSnapshot> {
    const current = this.getSnapshot();

    // Exit fullscreen if currently active (native or viewport fallback)
    if (current.isFullscreen) {
      this.viewportFallbackActive = false;
      this.notice = null;
      if (current.mode === 'native') {
        try {
          await this.adapter.exitNative();
        } catch {
          // Ignore if browser already exited fullscreen via Esc / system gesture
        }
      }
      this.emit();
      return this.getSnapshot();
    }

    // Attempt native browser Fullscreen API first
    if (this.adapter.isNativeSupported()) {
      try {
        await this.adapter.requestNative();
        this.viewportFallbackActive = false;
        this.notice = null;
        this.emit();
        return this.getSnapshot();
      } catch {
        // Blocked by browser permissions or iframe policy -> activate clean viewport-expanded fallback with BM notice
        this.viewportFallbackActive = true;
        this.notice =
          'Skrin penuh pelayar disekat pada tetingkap ini. Paparan permainan telah dimaksimumkan secara automatik.';
        this.emit();
        return this.getSnapshot();
      }
    }

    // Native Fullscreen API unavailable (e.g., iPhone iOS Safari) -> activate viewport-expanded fallback with BM notice
    this.viewportFallbackActive = true;
    this.notice =
      'Pelayar peranti ini tidak menyokong skrin penuh asli. Paparan permainan telah diluaskan sepenuh tetingkap.';
    this.emit();
    return this.getSnapshot();
  }
}
