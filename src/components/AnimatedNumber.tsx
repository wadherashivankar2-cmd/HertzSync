"use client";

import React, { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number | string;
  className?: string;
}

export function AnimatedNumber({ value, className = "" }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState<number | string>(value);
  const prevValueRef = useRef<number | string>(value);

  useEffect(() => {
    if (typeof value !== "number") {
      setDisplayValue(value);
      prevValueRef.current = value;
      return;
    }

    const startVal = typeof prevValueRef.current === "number" ? prevValueRef.current : 0;
    const endVal = value;
    prevValueRef.current = value;

    if (startVal === endVal) {
      setDisplayValue(endVal);
      return;
    }

    // Check prefers-reduced-motion
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setDisplayValue(endVal);
      return;
    }

    let animationFrameId: number;
    const startTime = performance.now();
    const duration = 350; // short ease-out count

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic: 1 - (1 - x)^3
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (endVal - startVal) * ease);

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(endVal);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [value]);

  return (
    <span className={`tabular-nums font-mono ${className}`}>
      {typeof displayValue === "number" ? displayValue.toLocaleString() : displayValue}
    </span>
  );
}

