"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft as ArrowLeftIcon } from "@gravity-ui/icons";
import { Button } from "@heroui/react";

export function AppBackButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      isIconOnly
      className={compact ? "h-4" : "h-9"}
      aria-label="返回上一页"
      onPress={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push("/");
      }}
    >
      <ArrowLeftIcon />
    </Button>
  );
}
