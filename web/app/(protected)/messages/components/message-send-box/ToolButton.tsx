import type { ReactNode } from "react";
import { Button, Tooltip } from "@heroui/react";

export function ToolButton({
  children,
  label,
  disabled,
  onPress,
}: {
  children: ReactNode;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          isIconOnly
          aria-label={label}
          isDisabled={disabled}
          onPress={onPress}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
