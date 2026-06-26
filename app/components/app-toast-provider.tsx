"use client";

import { Toast } from "@heroui/react";

export function AppToastProvider() {
  return <Toast.Provider placement="bottom end" maxVisibleToasts={5} />;
}
