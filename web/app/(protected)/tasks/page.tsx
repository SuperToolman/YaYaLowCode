import { Suspense } from "react";
import { SystemPageView } from "../(main)/[appId]/[formUuid]/system-page-view";

export default function TasksPage() {
  return <Suspense fallback={null}><SystemPageView appId="" pageSlug="tasks" pageTitle="我的任务" /></Suspense>;
}
