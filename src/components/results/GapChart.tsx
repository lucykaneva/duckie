"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

const INK = "#1d1d1f";
const BRAND = "#f5c518";
const BRAND_INK = "#3d2e00";
const MUTED = "#5c5b57";

type GapChartProps = {
  felt: number;
  understood: number;
};

export function GapChart({ felt, understood }: GapChartProps) {
  const data = [
    { label: "Felt", value: felt, fill: INK, labelFill: "#ffffff" },
    { label: "Understood", value: understood, fill: BRAND, labelFill: BRAND_INK },
  ];

  return (
    <div className="h-40 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            width={108}
            tick={{ fill: MUTED, fontSize: 15 }}
          />
          <Bar dataKey="value" barSize={36} radius={[0, 8, 8, 0]} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.label} fill={row.fill} />
            ))}
            <LabelList
              dataKey="value"
              position="insideRight"
              content={(props) => {
                const { x, y, width, height, value, index } = props;
                if (x == null || y == null || width == null || height == null) return null;
                const row = data[index ?? 0];
                const left = Number(x) + Number(width) - 12;
                const top = Number(y) + Number(height) / 2;
                return (
                  <text
                    x={left}
                    y={top}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill={row?.labelFill ?? INK}
                    fontSize={14}
                    fontWeight={500}
                  >
                    {value}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
