"use client";

import React from "react";

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({
  data,
  color = "var(--accent)",
  width = 84,
  height = 28,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="opacity-40"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const padding = 3;
  const effectiveHeight = height - padding * 2;
  const effectiveWidth = width - padding * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  // Single point or all identical values: draw steady horizontal line
  if (data.length === 1 || range === 0) {
    const y = height / 2;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        <line
          x1={padding}
          y1={y}
          x2={width - padding}
          y2={y}
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx={width - padding} cy={y} r="2.5" fill={color} />
      </svg>
    );
  }

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * effectiveWidth;
    const y = height - padding - ((val - min) / range) * effectiveHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const lastPoint = points[points.length - 1].split(",");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={parseFloat(lastPoint[0])}
        cy={parseFloat(lastPoint[1])}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}

