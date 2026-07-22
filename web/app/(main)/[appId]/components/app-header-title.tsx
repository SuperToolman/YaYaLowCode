"use client";

import { useEffect, useState } from "react";
import { getAppResource } from "../../../lib/app-resources";

export function AppHeaderTitle({
  appId,
  initialName,
}: {
  appId: string;
  initialName: string;
}) {
  const [appName, setAppName] = useState(initialName);

  useEffect(() => {
    let cancelled = false;

    void getAppResource(appId)
      .then((app) => {
        if (!cancelled) setAppName(app.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  return <>{appName}</>;
}
