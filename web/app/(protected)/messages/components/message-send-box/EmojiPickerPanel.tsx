"use client";
import { useTheme } from "@/components/ThemeProvider";
import Picker, { EmojiStyle, Theme } from "emoji-picker-react";
export function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { resolvedTheme } = useTheme();
  return <Picker onEmojiClick={data => onSelect(data.emoji)} emojiStyle={EmojiStyle.NATIVE} theme={resolvedTheme === "dark" ? Theme.DARK : Theme.LIGHT} searchPlaceHolder="搜索表情" width={320} height={380} lazyLoadEmojis />;
}
