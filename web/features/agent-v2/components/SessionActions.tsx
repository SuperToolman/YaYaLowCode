"use client";

import { useState } from "react";
import { Archive, ArrowRotateLeft, Pencil, Pin } from "@gravity-ui/icons";
import { Button, Input, Modal, Tooltip } from "@heroui/react";
import type { Session, SessionUpdate } from "../client";

type Props = { session: Session; disabled: boolean; onUpdate: (patch: Omit<SessionUpdate,"expectedVersion">) => Promise<boolean> };
export function SessionActions({session, disabled, onUpdate}: Props) {
  const [editing,setEditing]=useState(false);
  const [title,setTitle]=useState(session.title);
  const unfinished=Boolean(session.run_status && !["completed","failed","cancelled"].includes(session.run_status));
  return <>
    <div className="flex items-center justify-end" aria-label="当前会话操作">
      <Tooltip><Button isIconOnly variant="ghost" aria-label="重命名会话" isDisabled={disabled} onPress={()=>{setTitle(session.title);setEditing(true);}}><Pencil /></Button><Tooltip.Content>重命名</Tooltip.Content></Tooltip>
      <Tooltip><Button isIconOnly variant="ghost" aria-label={session.pinned?"取消置顶":"置顶会话"} isDisabled={disabled} onPress={()=>void onUpdate({pinned:!session.pinned})}><Pin /></Button><Tooltip.Content>{session.pinned?"取消置顶":"置顶"}</Tooltip.Content></Tooltip>
      <Tooltip><Button isIconOnly variant="ghost" aria-label={session.archived_at?"恢复会话":"归档会话"} isDisabled={disabled} onPress={()=>void onUpdate({archived:!session.archived_at})}>{session.archived_at?<ArrowRotateLeft />:<Archive />}</Button><Tooltip.Content>{session.archived_at?"恢复会话":unfinished?"归档并停止当前任务":"归档会话"}</Tooltip.Content></Tooltip>
    </div>
    <Modal isOpen={editing} onOpenChange={setEditing}><Modal.Backdrop><Modal.Container size="sm"><Modal.Dialog>
      <form onSubmit={event=>{event.preventDefault();void onUpdate({title:title.trim()}).then(ok=>{if(ok)setEditing(false);});}}>
        <Modal.Header><Modal.Heading>重命名会话</Modal.Heading><Modal.CloseTrigger isDisabled={disabled} /></Modal.Header>
        <Modal.Body><Input aria-label="会话标题" value={title} maxLength={120} onChange={event=>setTitle(event.currentTarget.value)} disabled={disabled} /></Modal.Body>
        <Modal.Footer><Button variant="ghost" onPress={()=>setEditing(false)} isDisabled={disabled}>取消</Button><Button type="submit" isDisabled={disabled || !title.trim()}>保存</Button></Modal.Footer>
      </form>
    </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </>;
}
