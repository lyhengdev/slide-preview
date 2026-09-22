import { useEffect, useState } from "react";

interface SlideStageProps {
  src: string;
  /** Blur-up placeholder tier (usually "preview"); omitted when displaying the preview itself. */
  previewSrc?: string;
  alt: string;
}

/**
 * Renders the slide as a small blurred frame that snaps into sharp focus the
 * moment the display-tier image arrives, so a slow connection never stalls the
 * judge waiting on a blank canvas. Keeps the `slide-canvas`/`slide-canvas-img`
 * classes CameraSecurity relies on to hide or blur content under its policy.
 */
export function SlideStage({ src, previewSrc, alt }: SlideStageProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  if (!previewSrc || previewSrc === src) {
    return (
      <div className="relative h-[70vh] w-full max-w-full">
        <img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          className="slide-canvas-img absolute inset-0 h-full w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="relative h-[70vh] w-full max-w-full">
      <img
        key={`${previewSrc}-placeholder`}
        src={previewSrc}
        alt=""
        aria-hidden
        draggable={false}
        className="slide-canvas-img absolute inset-0 h-full w-full scale-105 object-contain blur-[3px]"
      />
      <img
        key={src}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setReady(true)}
        className={`slide-canvas-img absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
          ready ? "opacity-100" : "opacity-0"
        }`}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/40">
          Loading…
        </div>
      )}
    </div>
  );
}