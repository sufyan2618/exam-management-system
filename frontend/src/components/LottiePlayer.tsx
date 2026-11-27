import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LottieLight } from "lottie-react";
import type { LottieHandle } from "lottie-react";

type LottiePlayerProps = {
  src: string;
  className?: string;
  segment?: readonly [number, number];
};

const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const getReducedMotion = () => window.matchMedia(motionQuery).matches;
const getPageVisible = () => !document.hidden;
const getServerReducedMotion = () => true;
const getServerVisible = () => false;

export function LottiePlayer({ src, className, segment }: LottiePlayerProps) {
  const player = useRef<LottieHandle>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion, getReducedMotion, getServerReducedMotion,
  );
  const visible = useSyncExternalStore(
    subscribeToVisibility, getPageVisible, getServerVisible,
  );
  const playing = !paused && !reducedMotion && visible;

  useEffect(() => {
    if (playing) player.current?.play();
    else player.current?.pause();
  }, [playing]);

  return (
    <div className={className}>
      <LottieLight
        className="lottie-canvas"
        src={src}
        lottieRef={player}
        autoplay={false}
        loop
        segment={segment}
        aria-hidden="true"
        rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
        subscriptions={{
          ready: () => {
            setFailed(false);
            if (playing) player.current?.play();
            else {
              player.current?.seek({ percent: 50 });
              player.current?.pause();
            }
          },
          error: () => setFailed(true),
        }}
      />
      {failed ? (
        <p className="animation-fallback" role="status">A little space. Endless possibility.</p>
      ) : (
        <button
          className="animation-control"
          type="button"
          onClick={() => setPaused((current) => !current)}
          disabled={reducedMotion}
          aria-label={reducedMotion ? "Animation paused for reduced motion" : paused ? "Play animation" : "Pause animation"}
          aria-pressed={paused || reducedMotion}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            {paused || reducedMotion ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
          </svg>
          <span>{reducedMotion ? "Reduced motion" : paused ? "Play animation" : "Pause animation"}</span>
        </button>
      )}
    </div>
  );
}
