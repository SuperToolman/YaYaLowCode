"use client";
import { Drawer } from "@heroui/react";

export function CustomButtonPageDrawer({name, url, onClose}: {name: string; url: string; onClose: () => void}) {
  return <Drawer isOpen onOpenChange={open => {if (!open) onClose();}}><Drawer.Backdrop><Drawer.Content placement="right"><Drawer.Dialog className="w-[min(1100px,100vw)]"><Drawer.Header><Drawer.Heading>{name}</Drawer.Heading><Drawer.CloseTrigger/></Drawer.Header><Drawer.Body><iframe title={name} src={url} className="h-[80vh] w-full border-0"/></Drawer.Body></Drawer.Dialog></Drawer.Content></Drawer.Backdrop></Drawer>;
}
