"use client";

import React from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  badge?: {
    text: string;
    variant: "success" | "warning" | "error" | "neutral";
  };
}

export function MetricCard({ title, value, subtitle, badge }: MetricCardProps) {
  const badgeClasses = {
    success: "bg-teal-950/60 text-teal-300 border-teal-600/40",
    warning: "bg-amber-950/60 text-amber-300 border-amber-600/40",
    error: "bg-red-950/60 text-red-300 border-red-600/40",
    neutral: "bg-slate-800 text-slate-300 border-slate-700",
  };

  return (
    <div className="bg-surface border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{title}</h3>
        {badge && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeClasses[badge.variant]}`}
          >
            {badge.text}
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl sm:text-3xl font-bold text-text tracking-tight font-mono">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {subtitle && <p className="text-xs text-muted mt-1.5">{subtitle}</p>}
      </div>
    </div>
  );
}

