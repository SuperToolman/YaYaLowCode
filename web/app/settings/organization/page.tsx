"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OrganizationSettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/identity-source");
  }, [router]);

  return null;
}
