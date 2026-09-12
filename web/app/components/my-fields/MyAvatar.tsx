import { Avatar } from "@heroui/react";
import styles from "./MyAvatar.module.css";

type MyAvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function MyAvatar({ name, imageUrl, size = "md", className }: MyAvatarProps) {
  const fallback = name.trim().slice(0, 1) || "?";

  return (
    <Avatar className={`${styles.avatar} ${styles[size]}${className ? ` ${className}` : ""}`}>
      {imageUrl ? <Avatar.Image src={imageUrl} alt={`${name}的头像`} /> : null}
      <Avatar.Fallback>{fallback}</Avatar.Fallback>
    </Avatar>
  );
}
