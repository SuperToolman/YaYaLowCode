"use client";
import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { applicationOrderAction, listApplicationOrders, listApplicationRevenues, type ApplicationOrder, type ApplicationRevenue } from "../api";
const labels: Record<string,string> = { pending_payment: "待支付", completed: "已完成", closed: "已关闭", refund_requested: "退款审核中", refunded: "已退款", pending_settlement: "待模拟结算", settled: "已模拟结算" };
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`;
export function ApplicationOrdersPanel({ mode, revision, canManage, onPay, onChanged }: { mode: "orders" | "revenues"; revision: number; canManage: boolean; onPay: (order: ApplicationOrder) => void; onChanged: () => void }) {
  const [orders, setOrders] = useState<ApplicationOrder[]>([]); const [revenues, setRevenues] = useState<ApplicationRevenue[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; Promise.all([mode === "orders" ? listApplicationOrders() : Promise.resolve([]), mode === "revenues" ? listApplicationRevenues() : Promise.resolve([])]).then(([o,r]) => { if(active) {setOrders(o);setRevenues(r);setError("");} }).catch(e => {if(active)setError(e instanceof Error ? e.message : "加载失败");}); return () => {active=false;}; }, [mode,revision]);
  async function act(order: ApplicationOrder, action: "cancel" | "refund") {
    const reason = action === "refund" ? window.prompt("请填写退款原因（当前为模拟退款，不涉及实际资金）") : undefined;
    if(action === "refund" && !reason?.trim()) return;
    setBusy(true);try {await applicationOrderAction(order.orderId,action,reason ?? undefined);onChanged();} catch(e){setError(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}
  }
  return <section className="space-y-4"><p className="rounded-xl bg-[var(--color-control-soft)] p-4 text-sm">{mode === "orders" ? "应用订单与整包权益。当前支付为流程模拟，无实际扣款。" : "仅显示本人发布商品的模拟销售收益；结算登记不代表实际到账。"}</p>{error && <p role="alert">{error}</p>}
    {mode === "orders" ? orders.map(o => <article className="rounded-xl border border-[var(--color-border)] p-4" key={o.orderId}><div className="flex flex-wrap justify-between gap-3"><strong>{o.snapshot.name} · {money(o.amountCents)}</strong><span>{labels[o.status] ?? o.status}</span></div><p className="my-2 text-xs text-[var(--color-text-secondary)]">{o.orderNo} · {o.owned ? "整包权益有效" : "未获得有效权益"}</p><div className="flex gap-2">{o.status === "pending_payment" && <><Button size="sm" isDisabled={!canManage || busy} onPress={() => onPay(o)}>继续支付</Button><Button size="sm" variant="secondary" isDisabled={!canManage || busy} onPress={() => void act(o,"cancel")}>关闭订单</Button></>}{o.status === "completed" && <Button size="sm" variant="secondary" isDisabled={!canManage || busy} onPress={() => void act(o,"refund")}>申请退款</Button>}</div></article>) : <><p className="text-sm">净销售额 {money(revenues.reduce((a,r)=>a+r.grossCents,0))} · 发布者收益 {money(revenues.reduce((a,r)=>a+r.amountCents,0))}</p>{revenues.map(r => <article key={r.id} className="rounded-xl border border-[var(--color-border)] p-4"><div className="flex justify-between gap-3"><span>{r.productId}</span><strong>{money(r.amountCents)}</strong></div><p className="mt-2 text-xs">{r.orderId} · 分成 {(r.rateBasisPoints / 100).toFixed(2)}% · {labels[r.status] ?? r.status}</p></article>)}</>}
    {(mode === "orders" ? orders.length === 0 : revenues.length === 0) && <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">暂无{mode === "orders" ? "应用订单" : "销售收益"}</p>}
  </section>;
}
