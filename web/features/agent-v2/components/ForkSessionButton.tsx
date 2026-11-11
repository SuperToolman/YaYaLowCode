"use client";

import { useRef, useState } from "react";
import { CodeFork } from "@gravity-ui/icons";
import { Button, Modal, Tooltip } from "@heroui/react";

type Props={disabled:boolean;onFork:(clientRequestId:string)=>Promise<boolean>};
export function ForkSessionButton({disabled,onFork}:Props){
 const [open,setOpen]=useState(false);
 const [pending,setPending]=useState(false);
 const requestId=useRef<string|null>(null);
 async function create(){
   if(pending)return;
   requestId.current ??= crypto.randomUUID();
   setPending(true);
   try{if(await onFork(requestId.current)){setOpen(false);requestId.current=null;}}
   finally{setPending(false);}
 }
 return <>
  <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="从此回复分叉会话" isDisabled={disabled || pending} onPress={()=>setOpen(true)}><CodeFork /></Button><Tooltip.Content>从此回复分叉</Tooltip.Content></Tooltip>
  <Modal isOpen={open} onOpenChange={value=>{if(!pending)setOpen(value);}}><Modal.Backdrop isDismissable={!pending}><Modal.Container size="sm"><Modal.Dialog>
   <Modal.Header><Modal.Heading>从此回复分叉会话</Modal.Heading><Modal.CloseTrigger isDisabled={pending} /></Modal.Header>
   <Modal.Body><p>复制到此回复为止的消息及相关文件，创建独立会话。历史工具不会重放，确认和脚本环境不会复制；原会话保持原状。切换后当前未发送的草稿会清空。</p></Modal.Body>
   <Modal.Footer><Button variant="ghost" isDisabled={pending} onPress={()=>setOpen(false)}>取消</Button><Button isPending={pending} onPress={()=>void create()}>创建分叉</Button></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
 </>;
}
