"use client";

import { Description, Fieldset, Input, Label, Radio, RadioGroup, TextArea, TextField } from "@heroui/react";

export type CommercialDraft = { pricingMode: "free" | "paid"; price: string; rate: string; description: string };
export const emptyCommercial: CommercialDraft = { pricingMode: "free", price: "", rate: "", description: "" };
export function commercialPayload(draft: CommercialDraft) {
  const decimal = /^\d+(?:\.\d{1,2})?$/;
  if (!draft.description.trim()) throw new Error("请填写商品说明");
  if (draft.pricingMode === "paid" && (!decimal.test(draft.price) || Number(draft.price) <= 0 || Number(draft.price) > 1000000 || !decimal.test(draft.rate) || Number(draft.rate) > 100)) throw new Error("请填写有效售价及发布者分成比例（0–100%，最多两位小数）");
  return { pricingMode: draft.pricingMode, priceCents: draft.pricingMode === "free" ? 0 : Math.round(Number(draft.price) * 100), publisherRateBasisPoints: draft.pricingMode === "free" ? 0 : Math.round(Number(draft.rate) * 100), currency: "CNY", licenseModel: "one_time", description: draft.description.trim() };
}
export function CommercialFields({ value, onChange, disabled = false, showHeading = true }: { value: CommercialDraft; onChange: (value: CommercialDraft) => void; disabled?: boolean; showHeading?: boolean }) {
  return (
    <Fieldset disabled={disabled} aria-label="销售与分成信息" className="w-full min-w-0 flex-none gap-4">
      {showHeading && <Fieldset.Legend>销售与分成信息</Fieldset.Legend>}
      <Fieldset.Group className="grid min-w-0 gap-4 space-y-0">
        <TextField isRequired value={value.description} onChange={description => onChange({ ...value, description })} isDisabled={disabled}>
          <Label>商品说明</Label>
          <TextArea rows={3} maxLength={2000} placeholder="介绍用途、整包范围及购买后可用能力" />
        </TextField>
        <RadioGroup
          value={value.pricingMode}
          onChange={pricingMode => onChange({ ...value, pricingMode: pricingMode as CommercialDraft["pricingMode"] })}
          isDisabled={disabled}
          orientation="horizontal"
        >
          <Label className="w-full">定价方式</Label>
          <Radio value="free">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <Label>免费领取</Label>
            </Radio.Content>
          </Radio>
          <Radio value="paid">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <Label>一次买断</Label>
            </Radio.Content>
          </Radio>
        </RadioGroup>
        {value.pricingMode === "paid" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField aria-label="整包售价" value={value.price} onChange={price => onChange({ ...value, price })} isDisabled={disabled}>
              <Label>整包售价（元）</Label>
              <Input inputMode="decimal" placeholder="例如 199.00" />
            </TextField>
            <TextField aria-label="发布者分成" value={value.rate} onChange={rate => onChange({ ...value, rate })} isDisabled={disabled}>
              <Label>发布者分成（%）</Label>
              <Input inputMode="decimal" placeholder="由运营审核确认" />
            </TextField>
          </div>
        )}
      </Fieldset.Group>
      <Description>整包授权；同商品后续兼容版本可升级。发布者分成为申请比例，审核通过后生效；余款为平台份额。免费领取不计收益。当前购买使用模拟支付，不发生实际扣款。</Description>
    </Fieldset>
  );
}
