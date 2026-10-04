const INK = "#1d1d1f";
const BRAND = "#f5c518";
const BRAND_INK = "#3d2e00";
const MUTED = "#5c5b57";

type GapChartProps = {
  felt: number;
  understood: number;
};

const BOX_W = 560;
const BAR_X = 116;
const BAR_MAX = 412;
const BAR_H = 28;

/** Almost a rounded bar, with 1px-class edge drift. */
function barPath(x: number, y: number, width: number, height: number): string {
  const w = Math.max(12, width);
  const r = Math.min(height / 2, w / 2);
  const x2 = x + w;
  const y2 = y + height;
  const mid = y + height / 2;
  return [
    `M ${x + r} ${y + 0.7}`,
    `C ${x + w * 0.38} ${y - 0.45}, ${x + w * 0.68} ${y + 0.85}, ${x2 - r} ${y + 0.35}`,
    `C ${x2 + 0.55} ${y + 2.2}, ${x2 + 0.7} ${mid - 2}, ${x2 + 0.15} ${mid}`,
    `C ${x2 + 0.7} ${mid + 3}, ${x2 + 0.2} ${y2 - 2.4}, ${x2 - r} ${y2 - 0.4}`,
    `C ${x + w * 0.66} ${y2 + 0.55}, ${x + w * 0.34} ${y2 - 0.65}, ${x + r} ${y2 - 0.25}`,
    `C ${x - 0.55} ${y2 - 2.6}, ${x - 0.45} ${mid + 2.2}, ${x + 0.2} ${mid}`,
    `C ${x - 0.4} ${mid - 3}, ${x + 0.3} ${y + 2.8}, ${x + r} ${y + 0.7}`,
    "Z",
  ].join(" ");
}

function EndMark({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={stroke} strokeLinecap="round">
      <path d="M0.8 -2.6C2.4 -2.3 3.1 -0.6 2.7 0.7C2.2 2.2 0.5 3  -0.6 2.4C-1.6 1.8 -1.5 0.2 -0.4 -1.1C0.1 -1.8 0.4 -2.4 0.8 -2.6Z" strokeWidth="1.1" />
    </g>
  );
}

export function GapChart({ felt, understood }: GapChartProps) {
  const rows = [
    { label: "Felt", value: felt, fill: INK, labelFill: "#ffffff" },
    { label: "Understood", value: understood, fill: BRAND, labelFill: BRAND_INK },
  ];

  return (
    <div className="w-full" aria-hidden="true">
      <svg viewBox={`0 0 ${BOX_W} 132`} className="h-auto w-full overflow-visible">
        {rows.map((row, index) => {
          const y = 14 + index * 60;
          const width = (Math.max(0, Math.min(100, row.value)) / 100) * BAR_MAX;
          const inside = width >= 72;
          const showBar = width >= 10;
          const endX = BAR_X + width + 5;
          return (
            <g key={row.label}>
              <text
                x={8}
                y={y + BAR_H / 2 + 1}
                fill={MUTED}
                fontSize="15"
                fontFamily="var(--font-sans)"
                dominantBaseline="middle"
              >
                {row.label}
              </text>
              {showBar ? (
                <path d={barPath(BAR_X, y, width, BAR_H)} fill={row.fill} />
              ) : null}
              {showBar && width >= 36 ? <EndMark x={endX} y={y + BAR_H / 2} stroke={INK} /> : null}
              <text
                x={inside ? BAR_X + width - 14 : BAR_X + Math.max(width, 0) + 18}
                y={y + BAR_H / 2 + 1}
                textAnchor={inside ? "end" : "start"}
                dominantBaseline="middle"
                fill={inside ? row.labelFill : MUTED}
                fontSize="14"
                fontWeight={500}
                fontFamily="var(--font-sans)"
              >
                {row.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
