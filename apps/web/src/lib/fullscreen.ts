type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

const doc = () => document as FullscreenDocument;

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FullscreenElement;
  return Boolean(document.documentElement.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = doc();
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function requestFullscreen(): Promise<boolean> {
  const el = document.documentElement as FullscreenElement;
  try {
    if (el.requestFullscreen) {
      return Promise.resolve(el.requestFullscreen())
        .then(() => true)
        .catch(() => false);
    }
    if (el.webkitRequestFullscreen) {
      return Promise.resolve(el.webkitRequestFullscreen())
        .then(() => true)
        .catch(() => false);
    }
  } catch {
    /* not supported */
  }
  return Promise.resolve(false);
}

export function exitFullscreen(): Promise<boolean> {
  const d = doc();
  try {
    if (d.exitFullscreen) {
      return Promise.resolve(d.exitFullscreen())
        .then(() => true)
        .catch(() => false);
    }
    if (d.webkitExitFullscreen) {
      return Promise.resolve(d.webkitExitFullscreen())
        .then(() => true)
        .catch(() => false);
    }
  } catch {
    /* ignore */
  }
  return Promise.resolve(false);
}

export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}