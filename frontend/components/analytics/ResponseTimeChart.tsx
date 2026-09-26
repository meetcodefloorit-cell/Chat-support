"use client";

import { useState } from "react";
import { ResponseTimePoint } from "@/lib/types";
import { formatBucketLabel, formatDuration } from "./format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClockIcon } from "@/components/ui/icons";

export function ResponseTimeChart({ points, granularity }: { points: ResponseTimePoint[]; granularity: "hour" | "day" | "week" }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const withData = points.filter((p) => p.avg_seconds != null);

  if (withData.length === 0) {
    return (
      <EmptyState
        icon={<ClockIcon />}
        title="No response-time data yet"
        description="No member message has been answered by the operator in this period."
        compact
      />
    );
  }

  const width = 720;
  const height = 180;
  const padLeft = 42;
  const padBottom = 24;
  const padTop = 12;
  const chartW = width - padLeft - 12;
  const chartH = height - padBottom - padTop;

  const maxVal = Math.max(1, ...points.map((p) => p.avg_seconds ?? 0));
  const stepX = points.length > 1 ? chartW / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padLeft + i * stepX,
    y: p.avg_seconds == null ? null : padTop + chartH - (p.avg_seconds / maxVal) * chartH,
    p,
  }));

  const segments: string[] = [];
  let current: string | null = null;
  for (const c of coords) {
    if (c.y == null) {
      current = null;
      continue;
    }
    if (current == null) {
      current = `M ${c.x} ${c.y}`;
      segments.push(current);
    } else {
      const idx = segments.length - 1;
      segments[idx] += ` L ${c.x} ${c.y}`;
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[480px]" style={{ height }}>
          {[0, 0.5, 1].map((frac, i) => {
            const y = padTop + chartH - frac * chartH;
            return (
              <g key={i}>
                <line x1={padLeft} y1={y} x2={width - 12} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize={9} fill="rgba(148,163,184,0.8)">
                  {formatDuration(maxVal * frac)}
                </text>
              </g>
            );
          })}

          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#2dd4bf" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {coords.map((c, i) =>
            c.y == null ? null : (
              <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}>
                <circle cx={c.x} cy={c.y} r={hoverIdx === i ? 4 : 2.5} fill="#2dd4bf" />
                <rect x={c.x - stepX / 2} y={padTop} width={Math.max(stepX, 6)} height={chartH} fill="transparent" />
              </g>
            ),
          )}

          {coords.map(
            (c, i) =>
              (i === 0 || i === coords.length - 1 || i === Math.floor(coords.length / 2)) && (
                <text key={i} x={c.x} y={height - 6} textAnchor="middle" fontSize={9} fill="rgba(148,163,184,0.8)">
                  {formatBucketLabel(c.p.bucket, granularity)}
                </text>
              ),
          )}
        </svg>
      </div>
      {hoverIdx != null && coords[hoverIdx]?.p && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <span className="font-medium text-white">{formatBucketLabel(coords[hoverIdx]!.p.bucket, granularity)}</span>
          <span className="ml-3">
            Avg reply time: <span className="text-white">{formatDuration(coords[hoverIdx]!.p.avg_seconds)}</span>
          </span>
          <span className="ml-3 text-slate-500">({coords[hoverIdx]!.p.sample_size} replies)</span>
        </div>
      )}
    </div>
  );
}
