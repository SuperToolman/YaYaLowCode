import { Suspense } from "react";
import { SystemPageView } from "@/features/records/screen/components/SystemPageView";

export default function TasksPage() {
  return <Suspense fallback={null}><SystemPageView appId="" pageSlug="tasks" pageTitle="我的任务" /></Suspense>;
}
