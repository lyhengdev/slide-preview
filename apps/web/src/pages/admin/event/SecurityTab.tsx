import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, ShieldCheck, Video } from "lucide-react";
import { API_BASE_URL } from "../../../lib/api";
import { Badge, Button, Card } from "../../../components/ui";

interface Settings {
  watermark: boolean;
  watermarkText: string | null;
  singleDevice: boolean;
  hideOnTabSwitch: boolean;
  blockScreenshots: boolean;
  requireFullscreen: boolean;
  faceDetection: boolean;
  multiplePersonDetection: boolean;
  phoneDetection: boolean;
  detectionAction: string;
}

const detectionActionColors: Record<string, string> = {
  LOG: "bg-ink-100 text-ink-600",
  WARN: "bg-amber-100 text-amber-700",
  BLUR: "bg-orange-100 text-orange-700",
  LOCK: "bg-red-100 text-red-700",
};

export function SecurityTab({ event }: { event: any }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Settings>(
    event.security ?? {
      watermark: true,
      watermarkText: "CONFIDENTIAL",
      singleDevice: true,
      hideOnTabSwitch: true,
      blockScreenshots: false,
      requireFullscreen: false,
      faceDetection: false,
      multiplePersonDetection: false,
      phoneDetection: false,
      detectionAction: "LOG",
    }
  );
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (body: Partial<Settings>) => {
      const res = await fetch(`${API_BASE_URL}/events/${event.id}/security`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not save security settings");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const toggle = (key: keyof Settings) => {
    const next = { ...s, [key]: !s[key] };
    setS(next);
    save.mutate({ [key]: !s[key] } as Partial<Settings>);
  };

  const groups: { title: string; icon: any; items: { key: keyof Settings; label: string; desc: string }[] }[] = [
    {
      title: "Presentation Security",
      icon: Eye,
      items: [
        { key: "watermark", label: "Judge Watermark", desc: "Each judge sees a unique personal watermark baked into slides." },
        { key: "singleDevice", label: "One device per judge", desc: "Blocks a judge from joining from a second device." },
        { key: "hideOnTabSwitch", label: "Hide on tab switch", desc: "Blurs the presentation when the judge leaves the tab." },
        { key: "blockScreenshots", label: "Screen capture protection", desc: "Hides and logs when the window loses focus (typical screenshot/capture moment)." },
        { key: "requireFullscreen", label: "Require fullscreen", desc: "Warns the judge if they exit fullscreen mode." },
      ],
    },
    {
      title: "Camera Security",
      icon: Video,
      items: [
        { key: "faceDetection", label: "Face presence detection", desc: "Detects when the judge is present in front of the camera." },
        { key: "multiplePersonDetection", label: "Multiple person detection", desc: "Alerts when more than one face is in the frame." },
        { key: "phoneDetection", label: "Visible secondary device", desc: "Flags a possible phone after repeated detections in camera view. Works independently of face detection." },
      ],
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g.title} className="p-5">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <g.icon className="h-4 w-4 text-accent-600" />
              {g.title}
            </h2>
            <div className="space-y-3">
              {g.items.map((item) => (
                <ToggleRow
                  key={item.key}
                  checked={!!s[item.key]}
                  label={item.label}
                  desc={item.desc}
                  onChange={() => toggle(item.key)}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="h-fit p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-accent-600" />
          Detection response
        </h2>

        <div className="mb-4">
          <select
            className="input"
            value={s.detectionAction}
            onChange={(e) => {
              setS({ ...s, detectionAction: e.target.value });
              save.mutate({ detectionAction: e.target.value });
            }}
          >
            <option value="LOG">Log only</option>
            <option value="WARN">Warning</option>
            <option value="BLUR">Blur presentation</option>
            <option value="LOCK">Lock presentation</option>
          </select>
          <p className="mt-1 text-xs text-ink-400">
            What happens when the camera or device flags a security event.
          </p>
          <div className="mt-3">
            <Badge color={detectionActionColors[s.detectionAction] as any}>{s.detectionAction}</Badge>
          </div>
        </div>

        <div className="space-y-3 border-t border-ink-100 pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Watermark text</p>
              <p className="text-xs text-ink-400">Shown across each judge's slides.</p>
            </div>
            <input
              className="input w-40"
              value={s.watermarkText ?? ""}
              onChange={(e) => setS({ ...s, watermarkText: e.target.value })}
              onBlur={() => save.mutate({ watermarkText: s.watermarkText })}
            />
          </div>

          <div className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
            <p className="font-medium text-ink-600">Camera processing</p>
            <p>Processing happens locally in the browser. Camera images are not recorded or uploaded. Detection starts in <b>LOG ONLY</b> mode — escalate to warn/blur/lock once tested in production.</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-400">{saved ? "Saved ✓" : "Changes save automatically"}</p>
          <Button onClick={() => save.mutate({ ...s })} loading={save.isPending}>
            Save all
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ToggleRow({
  checked,
  label,
  desc,
  onChange,
}: {
  checked: boolean;
  label: string;
  desc: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-ink-400">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-accent-600" : "bg-ink-200"
        }`}
        aria-label={label}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}