"use client";

import React from "react";
import { getStatusMeta, StatusColor } from "../lib/status-labels";

interface StatusBadgeProps {
  state: string;
  className?: string;
}

const COLOR_CLASSES: Record<StatusColor, string> = {
  pending: "bg-amber-950/50 text-amber-300 border-amber-600/50",
  accent: "bg-teal-950/50 text-teal-300 border-teal-600/50",
  failed: "bg-red-950/50 text-red-300 border-red-600/50",
  info: "bg-sky-950/50 text-sky-300 border-sky-600/50",
};

const DOT_CLASSES: Record<StatusColor, string> = {
  pending: "bg-amber-400",
  accent: "bg-teal-400",
  failed: "bg-red-400",
  info: "bg-sky-400",
};

export function StatusBadge({ state, className = "" }: StatusBadgeProps) {
  const meta = getStatusMeta(state);
  const colorClass = COLOR_CLASSES[meta.color] || COLOR_CLASSES.info;
  const dotClass = DOT_CLASSES[meta.color] || DOT_CLASSES.info;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass} ${className}`}
      title={meta.tooltip}
      aria-label={`${meta.label}: ${meta.tooltip}`}
      role="status"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

