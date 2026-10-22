"use client";

import {
  Autocomplete,
  Description,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  Tag,
  TagGroup,
  useFilter,
} from "@heroui/react";
import type { Key } from "@heroui/react";

const fileTypes = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "zip",
  "rar",
  "7z",
  "mp3",
  "wav",
  "mp4",
  "mov",
];

type FileTypeSelectProps = {
  value: string;
  onChange: (value: string) => void;
};

export function FileTypeSelect({ value, onChange }: FileTypeSelectProps) {
  const { contains } = useFilter({ sensitivity: "base" });

  const selectedKeys = [
    ...new Set(
      value
        .split(",")
        .map((extension) => extension.trim().replace(/^\.+/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
  const items = [...new Set([...fileTypes, ...selectedKeys])].map((id) => ({
    id,
    name: id.toUpperCase(),
  }));

  const onRemoveTags = (keys: Set<Key>) => {
    onChange(selectedKeys.filter((key) => !keys.has(key)).join(","));
  };

  return (
    <Autocomplete
      className="w-full max-w-[360px]"
      placeholder="选择文件类型"
      selectionMode="multiple"
      value={selectedKeys}
      onChange={(keys) => onChange((keys ?? []).join(","))}
      onClear={() => onChange("")}
    >
      <Label>文件白名单（允许上传的文件类型）</Label>
      <Autocomplete.Trigger>
        <Autocomplete.Value>
          {({ defaultChildren, isPlaceholder }) => {
            if (isPlaceholder || selectedKeys.length === 0) {
              return defaultChildren;
            }
            return (
              <TagGroup
                aria-label="已选文件类型"
                size="sm"
                onRemove={onRemoveTags}
              >
                <TagGroup.List>
                  {selectedKeys.map((selectedItemKey) => {
                    const item = items.find((s) => s.id === selectedItemKey);
                    if (!item) return null;
                    return (
                      <Tag key={item.id} id={item.id}>
                        {item.name}
                      </Tag>
                    );
                  })}
                </TagGroup.List>
              </TagGroup>
            );
          }}
        </Autocomplete.Value>
        <Autocomplete.ClearButton aria-label="清除已选文件类型" />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus aria-label="搜索文件类型" variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索扩展名…" />
              <SearchField.ClearButton aria-label="清除文件类型搜索" />
            </SearchField.Group>
          </SearchField>
          <ListBox
            aria-label="可选文件类型"
            renderEmptyState={() => <EmptyState>未找到文件类型</EmptyState>}
          >
            {items.map((item) => (
              <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                {item.name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
      <Description>留空表示不限制扩展名。</Description>
    </Autocomplete>
  );
}
