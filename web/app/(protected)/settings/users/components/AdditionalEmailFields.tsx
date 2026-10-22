"use client";

import { Button, Card, Description, Input, TextField } from "@heroui/react";
import { Plus, TrashBin } from "@gravity-ui/icons";
import type { EmailAddressItem } from "@features/identity-access";

export function AdditionalEmailFields({
  value,
  onChange,
}: {
  value: EmailAddressItem[];
  onChange: (value: EmailAddressItem[]) => void;
}) {
  function update(index: number, changes: Partial<EmailAddressItem>) {
    onChange(
      value.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...changes } : item,
      ),
    );
  }

  return (
    <Card className="p-2 border-1 border-dashed">
      <Card.Header
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <Card.Title>附加邮箱</Card.Title>
          <Description>由平台手动维护，不会被钉钉同步清空。</Description>
        </div>
        <Button onPress={() => onChange([...value, { label: "", email: "" }])}>
          <Plus aria-hidden="true" />
          添加邮箱
        </Button>
      </Card.Header>
      <Card.Content style={{ gap: 12 }}>
        {value.length ? (
          value.map((item, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 2fr) auto",
                alignItems: "center",
                gap: 8,
              }}
            >
              <TextField
                aria-label={`邮箱名称 ${index + 1}`}
                value={item.label}
                onChange={(label) => update(index, { label })}
                fullWidth
              >
                <Input placeholder="邮箱名称" />
              </TextField>
              <TextField
                aria-label={`邮箱地址 ${index + 1}`}
                value={item.email}
                onChange={(email) => update(index, { email })}
                fullWidth
              >
                <Input type="email" placeholder="邮箱地址" />
              </TextField>
              <TextField
                aria-label={`附加邮箱 SMTP 授权码 ${index + 1}`}
                value={item.smtpPassword ?? ""}
                onChange={(smtpPassword) =>
                  update(index, { smtpPassword, clearSmtpAuthorization: false })
                }
                fullWidth
              >
                <Input
                  type="password"
                  placeholder="SMTP 授权码，留空保留"
                />
              </TextField>
              <Button
                aria-label={`删除邮箱 ${index + 1}`}
                variant="ghost"
                isIconOnly
                onPress={() =>
                  onChange(
                    value.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
              >
                <TrashBin aria-hidden="true" />
              </Button>
            </div>
          ))
        ) : (
          <Description className="text-center">暂无附加邮箱，点击“添加邮箱”登记。</Description>
        )}
      </Card.Content>
    </Card>
  );
}
