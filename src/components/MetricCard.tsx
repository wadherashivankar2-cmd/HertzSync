"use client";

import React from "react";
import { Sparkline } from "./Sparkline";
import { AnimatedNumber } from "./AnimatedNumber";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  deltaLine?: React.ReactNode;
  sparklineData?: number[];
  sparklineColor?: string;
  badge?: {
    text: string;
    variant: "success" | "warning" | "error" | "neutral";
  };
}

export function MetricCard({
  title,
  value,
  subtitle,
  deltaLine,
  sparklineData,
  sparklineColor = "var(--accent)",
  badge,
}: MetricCardProps) {
  const badgeClasses = {
    success: "bg-success-bg text-success-text border-success-border",
    warning: "bg-warning-bg text-warning-text border-warning-border",
    error: "bg-danger-bg text-danger-text border-danger-border",
    neutral: "bg-surface-alt text-muted border-border",
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5 sm:p-6 shadow-lg flex flex-col justify-between transition-colors duration-200 h-full w-full min-w-0 box-border">
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-[1rem] font-semibold text-muted uppercase tracking-wider">{title}</h3>
          {badge && (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border ${badgeClasses[badge.variant]}`}
            >
              {badge.text}
            </span>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-3 mt-1">
          <div className="text-[3.5rem] font-bold text-text tracking-tight leading-none tabular-nums">
            <AnimatedNumber value={value} />
          </div>
          {sparklineData && sparklineData.length > 0 && (
            <div className="shrink-0" aria-hidden="true">
              <Sparkline data={sparklineData} color={sparklineColor} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border-subtle text-[1rem] text-muted">
        {deltaLine || subtitle}
      </div>
    </div>
  );
}
