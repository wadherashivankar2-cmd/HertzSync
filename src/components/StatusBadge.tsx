"use client";

import React from "react";
import { getStatusMeta, StatusColor } from "../lib/status-labels";

interface StatusBadgeProps {
  state: string;
  className?: string;
}

const COLOR_CLASSES: Record<StatusColor, string> = {
  pending: "bg-warning-bg text-warning-text border-warning-border",
  accent: "bg-success-bg text-success-text border-success-border",
  failed: "bg-danger-bg text-danger-text border-danger-border",
  info: "bg-info-bg text-info-text border-info-border",
};

const DOT_CLASSES: Record<StatusColor, string> = {
  pending: "bg-warning-text",
  accent: "bg-success-text",
  failed: "bg-danger-text",
  info: "bg-info-text",
};

export function StatusBadge({ state, className = "" }: StatusBadgeProps) {
  const meta = getStatusMeta(state);
  const colorClass = COLOR_CLASSES[meta.color] || COLOR_CLASSES.info;
  const dotClass = DOT_CLASSES[meta.color] || DOT_CLASSES.info;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${colorClass} ${className}`}
      title={meta.tooltip}
      aria-label={`${meta.label}: ${meta.tooltip}`}
      role="status"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
