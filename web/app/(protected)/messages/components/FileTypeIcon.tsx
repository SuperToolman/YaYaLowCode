import type { CSSProperties } from "react";
import { File, FileZipper, MusicNote, Video } from "@gravity-ui/icons";
import { filePresentation } from "./file-presentation";
import styles from "./file-card.module.css";
export function FileTypeIcon({ name, mimeType }: { name: string; mimeType: string }) {
  const type = filePresentation(name, mimeType);
  const Icon = type.category === "压缩包" ? FileZipper : type.category === "音频" ? MusicNote : type.category === "视频" ? Video : File;
  return <span className={styles.icon} style={{ "--file-color": type.color } as CSSProperties} aria-hidden="true">{type.symbol || <Icon width={20} height={20} />}</span>;
}
