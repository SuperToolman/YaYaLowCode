"use client";

import { useId, useState } from "react";
import { Button, Modal, Tabs } from "@heroui/react";

type PaymentMethod = "alipay" | "wechat";
type PaymentTab = "online" | "remittance";

export type RemittanceAccount = {
  accountName: string;
  bankName: string;
  accountNumber: string;
  branchName?: string;
};

export type PaymentModalProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  remittanceAccount?: RemittanceAccount | null;
  enterpriseVerificationHref?: string;
  onVerifyEnterprise?: () => void;
  productTitle?: string;
  amountCents?: number;
  billingLabel?: string;
  onTestPaymentComplete?: () => boolean | void | Promise<boolean | void>;
};

const paymentMethods: Array<{ id: PaymentMethod; label: string; description: string; icon: string; iconClassName: string }> = [
  { id: "alipay", label: "支付宝", description: "使用支付宝扫码完成支付", icon: "支", iconClassName: "bg-[#1677ff]" },
  { id: "wechat", label: "微信支付", description: "使用微信扫码完成支付", icon: "微", iconClassName: "bg-[#07c160]" },
];

export function PaymentModal({ isOpen, onOpenChange, remittanceAccount = null, enterpriseVerificationHref = "#", onVerifyEnterprise, productTitle, amountCents, billingLabel, onTestPaymentComplete }: PaymentModalProps) {
  const [tab, setTab] = useState<PaymentTab>("online");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [testingPayment, setTestingPayment] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setTab("online");
      setMethod(null);
      setTestingPayment(false);
    }
  }

  async function completeTestPayment() {
    if (!onTestPaymentComplete || testingPayment) return;
    setTestingPayment(true);
    try {
      const completed = await onTestPaymentComplete();
      if (completed === false) return;
      handleOpenChange(false);
    } finally {
      setTestingPayment(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md bg-[var(--color-bg-surface)]">
            <Modal.Header>
              <Modal.Heading>支付</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭支付模态框" />
            </Modal.Header>
            <Modal.Body className="space-y-5">
              {productTitle ? <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-y border-[var(--color-border)] py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{productTitle}</p>{billingLabel ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{billingLabel}</p> : null}</div><strong className="text-base text-[var(--color-text-primary)]">{formatMoney(amountCents ?? 0)}</strong></div> : null}
              <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as PaymentTab)}>
                <Tabs.List aria-label="支付方式" className="w-full">
                  <Tabs.Tab id="online" className="flex-1 py-2 text-sm">
                    在线充值
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="remittance" className="flex-1 py-2 text-sm">
                    对公汇款
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel id="online" className="pt-5 outline-none">
                  <OnlinePayment method={method} onSelect={setMethod} />
                </Tabs.Panel>
                <Tabs.Panel id="remittance" className="pt-5 outline-none">
                  <RemittanceDetails account={remittanceAccount} enterpriseVerificationHref={enterpriseVerificationHref} onVerifyEnterprise={onVerifyEnterprise} />
                </Tabs.Panel>
              </Tabs>
              {onTestPaymentComplete ? <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] pt-4"><p className="text-xs text-[var(--color-text-secondary)]">模拟支付会在运营端创建订单、登记回款并签发新许可证。</p><Button variant="secondary" isPending={testingPayment} isDisabled={testingPayment} onPress={() => void completeTestPayment()}>{testingPayment ? "正在模拟支付" : "测试支付完成"}</Button></div> : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function OnlinePayment({ method, onSelect }: { method: PaymentMethod | null; onSelect: (method: PaymentMethod) => void }) {
  const selected = paymentMethods.find((item) => item.id === method);

  return <div className="space-y-5">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {paymentMethods.map((item) => {
        const isSelected = method === item.id;
        return <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`flex min-h-20 items-center gap-3 rounded-md border p-3 text-left transition-colors ${isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)] hover:border-[var(--color-primary)]"}`}>
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-semibold text-white ${item.iconClassName}`}>{item.icon}</span>
          <span className="min-w-0"><span className="block text-sm font-medium text-[var(--color-text-primary)]">{item.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">{item.description}</span></span>
        </button>;
      })}
    </div>
    {selected ? <div className="border-t border-[var(--color-border)] pt-5"><div className="flex flex-col items-center"><PaymentQrCode method={selected.id} /><p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">请使用{selected.label}扫描二维码</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">二维码仅为前端展示，暂不发起真实支付</p></div></div> : <p className="py-3 text-center text-sm text-[var(--color-text-secondary)]">请选择支付方式</p>}
  </div>;
}

function RemittanceDetails({ account, enterpriseVerificationHref, onVerifyEnterprise }: { account: RemittanceAccount | null; enterpriseVerificationHref: string; onVerifyEnterprise?: () => void }) {
  if (!account) return <div className="flex min-h-44 flex-col items-center justify-center text-center"><p className="text-sm text-[var(--color-text-secondary)]">暂未获取到专属汇款账号</p><a href={enterpriseVerificationHref} className="mt-3 text-sm text-[var(--color-primary)] hover:underline" onClick={onVerifyEnterprise}>企业实名认证后，可获取专属汇款账号</a></div>;
  return <dl className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] text-sm"><Info label="收款方名称" value={account.accountName} /><Info label="开户银行" value={account.bankName} /><Info label="银行账号" value={account.accountNumber} mono />{account.branchName ? <Info label="开户支行" value={account.branchName} /> : null}</dl>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4 py-3"><dt className="text-[var(--color-text-secondary)]">{label}</dt><dd className={`break-all text-[var(--color-text-primary)] ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}

function PaymentQrCode({ method }: { method: PaymentMethod }) {
  const id = useId().replace(/:/g, "");
  const cells = Array.from({ length: 121 }, (_, index) => (index * 13 + (method === "alipay" ? 7 : 11)) % 17 < 8);
  return <div className="border border-[var(--color-border)] bg-white p-3" aria-label={`${method === "alipay" ? "支付宝" : "微信支付"}二维码示意`}><div className="grid h-48 w-48 grid-cols-11 gap-px bg-white">{cells.map((filled, index) => <span key={`${id}-${index}`} className={filled ? "bg-slate-900" : "bg-white"} />)}</div></div>;
}
