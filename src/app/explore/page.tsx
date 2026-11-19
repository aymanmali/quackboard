import React, { Suspense } from "react";
import { ChartStudio } from "@/components/studio/ChartStudio";

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Loading Chart Studio...
        </div>
      }
    >
      <ChartStudio />
    </Suspense>
  );
}
