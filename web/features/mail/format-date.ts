export function formatMailDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
