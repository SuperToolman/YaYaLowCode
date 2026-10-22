"use client";

import { DisplayTag } from "@shared/DisplayTag";

import { Avatar } from "@heroui/react";
import type { UserItem } from "@features/identity-access";

export function SourceTag({ source }: { source: string }) {
  return (
    <DisplayTag color={source === "dingtalk" ? "accent" : "warning"}>
      {source === "dingtalk" ? "钉钉" : "平台"}
    </DisplayTag>
  );
}

export function UserAvatar({ user }: { user: UserItem }) {
  return (
    <Avatar>
      {user.avatarUrl ? <Avatar.Image src={user.avatarUrl} alt="" /> : null}
      <Avatar.Fallback>
        {getAvatarFallbackText(user.displayName)}
      </Avatar.Fallback>
    </Avatar>
  );
}

function getAvatarFallbackText(displayName: string) {
  const characters = Array.from(displayName.trim());
  return characters.length > 2
    ? characters.slice(-2).join("")
    : characters.join("") || "?";
}

