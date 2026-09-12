"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

type RumMetric = {
  name: string;
  value: number;
  id?: string;
  rating?: string;
  navigationType?: string;
  attribution?: unknown;
};

function report(metric: RumMetric) {
  const body = JSON.stringify(metric);
  if (navigator.sendBeacon?.("/api/rum", new Blob([body], { type: "application/json" }))) return;
  void fetch("/api/rum", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
  });
}

export function WebVitalsReporter() {
  useReportWebVitals(report);

  useEffect(() => {
    if (!PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;

    const samples: Array<{ duration: number; startTime: number }> = [];
    const flush = () => {
      if (samples.length === 0) return;
      const batch = samples.splice(0);
      const totalDuration = batch.reduce((total, sample) => total + sample.duration, 0);
      report({
        name: "longtask",
        value: Math.max(...batch.map((sample) => sample.duration)),
        attribution: {
          count: batch.length,
          totalDuration,
          firstStartTime: batch[0].startTime,
          lastStartTime: batch.at(-1)?.startTime,
        },
      });
    };
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        samples.push({ duration: entry.duration, startTime: entry.startTime });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    const flushTimer = window.setInterval(flush, 15_000);
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flush);
    return () => {
      observer.disconnect();
      window.clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return null;
}
