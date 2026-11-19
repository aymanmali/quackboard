"use client";

import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsOption } from "echarts";

export interface EChartsHandle {
  exportPng: (fileName?: string) => void;
}

interface EChartsRendererProps {
  option: EChartsOption;
  className?: string;
  onDatumClick?: (info: { name: string; seriesName?: string; value?: unknown }) => void;
}

export const EChartsRenderer = forwardRef<EChartsHandle, EChartsRendererProps>(
  function EChartsRenderer({ option, className = "w-full h-full", onDatumClick }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<ECharts | null>(null);
    const onClickRef = useRef(onDatumClick);
    onClickRef.current = onDatumClick;

    useImperativeHandle(ref, () => ({
      exportPng(fileName = "quackboard-chart.png") {
        if (!chartRef.current) return;
        const url = chartRef.current.getDataURL({
          type: "png",
          pixelRatio: 2,
          backgroundColor: "#ffffff",
        });
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;
      const instance = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
      chartRef.current = instance;

      instance.on("click", (params) => {
        if (onClickRef.current && params.name) {
          onClickRef.current({
            name: String(params.name),
            seriesName: params.seriesName ? String(params.seriesName) : undefined,
            value: params.value,
          });
        }
      });

      let rafId: number | null = null;
      const observer = new ResizeObserver(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          instance.resize();
        });
      });
      observer.observe(containerRef.current);

      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        observer.disconnect();
        instance.dispose();
        chartRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (!chartRef.current) return;
      chartRef.current.setOption(option, { notMerge: true });
    }, [option]);

    return <div ref={containerRef} className={className} />;
  }
);
