"use client";

import dynamic from "next/dynamic";
import { EmbeddedRecordsPageContext, type RecordsPageProps } from "./embedded-page-context";

const RecordsPage = dynamic(
  () => import("./components/FormRecordsScreen").then(module => module.FormRecordsScreen),
  { loading: () => <p role="status">正在加载表单页面…</p> },
);

function renderRecordsPage(props: RecordsPageProps) {
  return <RecordsPage key={`${props.appId}:${props.formUuid}`} {...props} />;
}

export function RecordsWorkspace(props: RecordsPageProps) {
  return (
    <EmbeddedRecordsPageContext.Provider value={renderRecordsPage}>
      <RecordsPage {...props} />
    </EmbeddedRecordsPageContext.Provider>
  );
}
