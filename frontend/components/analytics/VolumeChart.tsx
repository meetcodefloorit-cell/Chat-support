"use client";

import { useState } from "react";
import { VolumePoint } from "@/lib/types";
import { formatBucketLabel, formatCount } from "./format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartBarIcon } from "@/components/ui/icons";

const SERIES: { key: keyof VolumePoint; label: string; color: string }[] = [
  { key: "conversations_started", label: "Conversations started", color: "#22d3ee" },
  { key: "messages_sent", label: "Operator messages", color: "#38bdf8" },
  { key: "messages_received", label: "Member messages", color: "#a78bfa" },
];

export function VolumeChart({ points, granularity }: { points: VolumePoint[]; granularity: "hour" | "day" | "week" }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return <EmptyState icon={<ChartBarIcon />} title="No activity yet" description="No conversation or message activity in this period." compact />;
  }

  const width = 720;
  const height = 220;
  const padLeft = 36;
  const padBottom = 24;
  const padTop = 10;
  const chartW = width - padLeft - 12;
  const chartH = height - padBottom - padTop;

  const maxVal = Math.max(1, ...points.flatMap((p) => SERIES.map((s) => Number(p[s.key] ?? 0))));
  const groupW = chartW / points.length;
  const barW = Math.max(2, (groupW / SERIES.length) * 0.7);

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[480px]" style={{ height }}>
          {tickVals.map((t, i) => {
            const y = padTop + chartH - (t / maxVal) * chartH;
            return (
              <g key={i}>
                <line x1={padLeft} y1={y} x2={width - 12} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize={9} fill="rgba(148,163,184,0.8)">
                  {t}
                </text>
              </g>
            );
          })}

          {points.map((p, i) => {
            const groupX = padLeft + i * groupW;
            return (
              <g
                key={p.bucket}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              >
                <rect x={groupX} y={padTop} width={groupW} height={chartH} fill="transparent" />
                {SERIES.map((s, si) => {
                  const val = Number(p[s.key] ?? 0);
                  const h = maxVal > 0 ? (val / maxVal) * chartH : 0;
                  const x = groupX + si * (groupW / SERIES.length) + (groupW / SERIES.length - barW) / 2;
                  const y = padTop + chartH - h;
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={1.5}
                      fill={s.color}
                      opacity={hoverIdx === null || hoverIdx === i ? 0.9 : 0.35}
                    />
                  );
                })}
                {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
                  <text
                    x={groupX + groupW / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize={9}
                    fill="rgba(148,163,184,0.8)"
                  >
                    {formatBucketLabel(p.bucket, granularity)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {hoverIdx != null && points[hoverIdx] && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <span className="font-medium text-white">{formatBucketLabel(points[hoverIdx].bucket, granularity)}</span>
          {SERIES.map((s) => (
            <span key={s.key} className="ml-3">
              {s.label}: <span className="text-white">{formatCount(Number(points[hoverIdx]![s.key]))}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
