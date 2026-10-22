export function getFieldDescription(type: string, props: {
  description?: string;
  showUploadLimitHint?: boolean;
  maxFileSizeMb?: number;
}) {
  const description = props.description?.trim() ?? "";
  if (!["attachment", "imageUpload"].includes(type) || props.showUploadLimitHint === false) return description;
  const hint = `单个文件不超过 ${props.maxFileSizeMb ?? 20} MB`;
  return description ? `${hint}，${description}` : hint;
}
