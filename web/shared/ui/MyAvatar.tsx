import { Avatar } from "@heroui/react";
const avatarSizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
};

type MyAvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: React.CSSProperties;
};

export function MyAvatar({ name, imageUrl, size = "md", className, style }: MyAvatarProps) {
  const fallback = name.trim().slice(0, 1) || "?";

  return (
    <Avatar size={size} className={`shrink-0 rounded-[var(--radius,.5rem)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)] ${avatarSizeClasses[size]}${className ? ` ${className}` : ""}`} style={style}>
      {imageUrl ? <Avatar.Image className="h-full w-full object-cover" src={imageUrl} alt={`${name}的头像`} /> : null}
      <Avatar.Fallback className={`bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)] ${size === "sm" ? "text-[10px]" : size === "lg" ? "text-base" : "text-sm"}`}>{fallback}</Avatar.Fallback>
    </Avatar>
  );
}
