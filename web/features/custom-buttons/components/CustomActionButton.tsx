"use client";
import { Button, Tooltip } from "@heroui/react";
import { DEFAULT_DISABLED_REASON, type ButtonDraft } from "@/features/custom-buttons/model";
import { CustomButtonIcon } from "@/features/custom-buttons/icons";
export function CustomActionButton({ config, conditionMet, onPress }: { config: Pick<ButtonDraft, "name" | "icon"> & { disabledReason?: string }; conditionMet: boolean; onPress?: () => void }) {
  const button = <Button isDisabled={!conditionMet} onPress={conditionMet ? onPress : undefined}><CustomButtonIcon icon={config.icon}/>{config.name.trim() || "未命名按钮"}</Button>;
  return conditionMet ? button : <Tooltip><Tooltip.Trigger><span tabIndex={0} aria-label={`${config.name || "按钮"}：${config.disabledReason?.trim() || DEFAULT_DISABLED_REASON}`} className="inline-flex cursor-not-allowed">{button}</span></Tooltip.Trigger><Tooltip.Content>{config.disabledReason?.trim() || DEFAULT_DISABLED_REASON}</Tooltip.Content></Tooltip>;
}
