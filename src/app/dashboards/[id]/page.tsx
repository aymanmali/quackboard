import React from "react";
import { DashboardCanvas } from "@/components/dashboard/DashboardCanvas";

export default async function DashboardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DashboardCanvas dashboardId={id} />;
}
