/* eslint-disable @next/next/no-img-element -- local clipboard blob previews */
import { useState, type CSSProperties } from "react";
import { Card, Chip } from "@heroui/react";
import type { DraftAsset } from "./draft";
import styles from "../file-card.module.css";
import { FileTypeIcon } from "../FileTypeIcon";
import { filePresentation, formatFileSize } from "../file-presentation";
import { imageSize } from "./draft";
export function AttachmentPreview({ asset }: { asset?: DraftAsset }) {
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [broken, setBroken] = useState(false);
  if (!asset) return <span>附件已失效</span>;
  const type = filePresentation(asset.name, asset.mimeType);
  return (
    <span
      className="relative inline-flex max-w-full items-center gap-1 align-bottom"
      contentEditable={false}
    >
      {asset.url && !broken ? (
        <img
          src={asset.url}
          alt={asset.name}
          style={
            dimensions
              ? imageSize(dimensions.width, dimensions.height)
              : { maxWidth: 200, maxHeight: 144, objectFit: "contain" }
          }
          onLoad={(event) =>
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={() => setBroken(true)}
        />
      ) : (
        <Card data-file-type={type.category} style={{ "--file-color": type.color } as CSSProperties} className={`inline-flex w-56 max-w-full flex-row items-center gap-2 p-2 ${styles.fileCard}`}>
          <FileTypeIcon name={asset.name} mimeType={asset.mimeType} />
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={asset.name}>
              {asset.name}
            </span>
            <span className="block text-xs">
              {formatFileSize(asset.size)}
            </span>
          </span>
          <Chip size="sm" variant="soft">{type.category}</Chip>
        </Card>
      )}
    </span>
  );
}
