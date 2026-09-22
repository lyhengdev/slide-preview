import { useEffect, useRef, useState } from "react";

export type WatermarkInfo = {
  judgeCode: string;
  eventTitle: string;
  sessionId: string;
};

function timeString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function WatermarkOverlay({ info }: { info: WatermarkInfo }) {
  const [position, setPosition] = useState({ x: 16, y: 16 });
  const [time, setTime] = useState(timeString());
  const frameRef = useRef(0);

  useEffect(() => {
    setInterval(() => setTime(timeString()), 30_000);
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
    };
    animate();
    const move = setInterval(() => {
      setPosition((prev) => ({
        x: 16 + Math.random() * 24,
        y: 16 + Math.random() * 24,
      }));
    }, 15_000);
    return () => {
      cancelAnimationFrame(frameRef.current);
      clearInterval(move);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 select-none" data-watermark="overlay">
      <div
        className="absolute rounded bg-ink-900/55 px-2 py-1 text-[10px] font-medium tracking-wide text-white/85 backdrop-blur-[1px]"
        style={{ left: position.x, top: position.y }}
      >
        {info.judgeCode} · {info.eventTitle}
        <br />
        {info.sessionId.slice(0, 6)} · {time}
      </div>
    </div>
  );
}