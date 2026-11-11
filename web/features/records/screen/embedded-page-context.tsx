"use client";

import { createContext, useContext, type ReactNode } from "react";

export type RecordsPageProps = {
  appId: string;
  formUuid: string;
  embedded?: boolean;
  readOnly?: boolean;
  pageParameters?: Record<string, string>;
};

/** The workspace supplies page composition; actions never import the full screen. */
export type RenderRecordsPage = (props: RecordsPageProps) => ReactNode;

export const EmbeddedRecordsPageContext = createContext<RenderRecordsPage | null>(null);

export function useEmbeddedRecordsPage() {
  return useContext(EmbeddedRecordsPageContext);
}
