"use client";
import { Calendar, DateField, DatePicker } from "@heroui/react";
import { parseAbsoluteToLocal, parseDate, parseDateTime, parseZonedDateTime, type DateValue } from "@internationalized/date";

export function ConditionDateValue({ value, onChange, dateTime = false, label }: { value: string; onChange: (value: string) => void; dateTime?: boolean; label: string }) {
  let parsed: DateValue | null = null;
  try { if (value) parsed = dateTime ? value.includes("[") ? parseZonedDateTime(value) : /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? parseAbsoluteToLocal(value) : parseDateTime(value) : parseDate(value); } catch { /* Invalid saved values remain editable. */ }
  return <DatePicker aria-label={label} value={parsed} granularity={dateTime ? "minute" : "day"} onChange={next => onChange(next ? "toAbsoluteString" in next ? next.toAbsoluteString() : next.toString() : "")}>
    <DateField.Group><DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input><DateField.Suffix><DatePicker.Trigger><DatePicker.TriggerIndicator /></DatePicker.Trigger></DateField.Suffix></DateField.Group>
    <DatePicker.Popover><Calendar aria-label="选择条件日期"><Calendar.Header><Calendar.YearPickerTrigger><Calendar.YearPickerTriggerHeading /><Calendar.YearPickerTriggerIndicator /></Calendar.YearPickerTrigger><Calendar.NavButton slot="previous" /><Calendar.NavButton slot="next" /></Calendar.Header><Calendar.Grid><Calendar.GridHeader>{day => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader><Calendar.GridBody>{date => <Calendar.Cell date={date} />}</Calendar.GridBody></Calendar.Grid></Calendar></DatePicker.Popover>
  </DatePicker>;
}
