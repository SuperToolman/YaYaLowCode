"use client";
import { useEffect,useState } from "react";
import { Button } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { CommercialFields,commercialPayload,emptyCommercial } from "./CommercialFields";
import { listCommercialVersions,submitCommercialVersion } from "../api";
import type { CommercialVersion } from "@/shared/lib/http";
export function PublisherCommercialDialog({productId,releaseId,name,onClose}:{productId:string;releaseId:string;name:string;onClose:()=>void}){
 const [draft,setDraft]=useState(emptyCommercial);const [items,setItems]=useState<CommercialVersion[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [status,setStatus]=useState("");
 useEffect(()=>{let active=true;listCommercialVersions(productId).then(v=>{if(active)setItems(v);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"加载失败");});return()=>{active=false;};},[productId]);
 async function submit(){setBusy(true);setError("");try{await submitCommercialVersion(productId,{releaseId,config:commercialPayload(draft)});setItems(await listCommercialVersions(productId));setStatus("商业变更已提交，等待运营审核并重新上架。既有订单不受影响。");}catch(e){setError(e instanceof Error?e.message:"提交失败");}finally{setBusy(false);}}
 return <Modal isOpen onOpenChange={open=>{if(!open&&!busy)onClose();}}><Modal.Backdrop><Modal.Container placement="center"><Modal.Dialog className="w-[760px] max-w-[calc(100vw-2rem)] max-h-[90dvh] overflow-y-auto"><Modal.Header><Modal.Heading>{name} · 销售配置</Modal.Heading><Modal.CloseTrigger/></Modal.Header><Modal.Body><p className="text-sm">商业变更复用当前发布版本，无需重新打包。提交新的价格或分成后，由运营审核决定生效。</p><CommercialFields value={draft} onChange={setDraft} disabled={busy}/>{error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}<div className="mt-5 space-y-3">{items.map(v=><article key={v.id} className="rounded-xl border border-[var(--color-border)] p-3 text-sm"><p>{v.config.pricingMode==="free"?"免费":`¥${(v.config.priceCents/100).toFixed(2)}`} · 发布者 {(v.config.publisherRateBasisPoints/100).toFixed(2)}% · {v.status}</p><p className="mt-1 text-xs">{v.config.description} {v.reason}</p></article>)}</div></Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={busy} onPress={onClose}>关闭</Button><Button isPending={busy} onPress={()=>void submit()}>提交商业变更</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
