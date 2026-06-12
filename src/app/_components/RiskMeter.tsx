import { RISK, type RiskTier } from "@/lib/atlas";

export function RiskMeter({ score, tier }: { score: number; tier: RiskTier }) {
  const r = RISK[tier];
  const angle = (Math.min(100, Math.max(0, score)) / 100) * 180;
  const cx = 70, cy = 70, rad = 56;
  const a = (Math.PI * (180 - angle)) / 180;
  const nx = cx + rad * Math.cos(a);
  const ny = cy - rad * Math.sin(a);
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 84" className="w-36">
        <path d={`M14,70 A56,56 0 0 1 126,70`} fill="none" stroke="var(--color-rule)" strokeWidth="9" strokeLinecap="round" />
        <path
          d={`M14,70 A56,56 0 0 1 126,70`}
          fill="none"
          stroke={r.color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(angle / 180) * 176} 999`}
        />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--color-ink)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="3.5" fill="var(--color-ink)" />
      </svg>
      <div>
        <div className="tnum text-4xl font-semibold" style={{ color: r.color }}>{score}</div>
        <div className="text-sm" style={{ color: r.color }}>{r.label} risk</div>
        <div className="text-xs text-faint">of closure, /100</div>
      </div>
    </div>
  );
}
