import { CircleFill } from "@gravity-ui/icons";
import { Chip } from "@heroui/react";
import type { ComponentProps } from "react";

interface MyShipProps {
  content: string;
  color?: ComponentProps<typeof Chip>["color"];
}

export function MyShip({ content, color }: MyShipProps) {
  return (
    <Chip color={color} variant="primary">
      <CircleFill width={6} />
      <Chip.Label>{content}</Chip.Label>
    </Chip>
  );
}
