"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, SearchField, Spinner } from "@heroui/react";
import { notifyRequestError } from "@/shared/lib/notify";
import { listSessions, type Employee, type Session } from "../client";
import { AgentEmployeeAvatar } from "./AgentEmployeeAvatar";

function HighlightedText({text,keyword}:{text:string;keyword:string}) {
 const parts=[];
 const needle=keyword.toLocaleLowerCase();
 if(!needle)return <>{text}</>;
 const source=text.toLocaleLowerCase();
 let offset=0;
 while(offset<text.length){
  const index=source.indexOf(needle,offset);
  if(index<0){parts.push(text.slice(offset));break;}
  parts.push(text.slice(offset,index));
  parts.push(<mark key={index}>{text.slice(index,index+keyword.length)}</mark>);
  offset=index+keyword.length;
 }
 return <>{parts}</>;
}

type Group = {items:Session[];cursor:string|null};
const empty=():Group=>({items:[],cursor:null});
export function ArchiveSearchModal({employees,onClose,onView}:{employees:Employee[];onClose:()=>void;onView:(session:Session)=>void}){
 const [query,setQuery]=useState("");
 const [keyword,setKeyword]=useState("");
 const [title,setTitle]=useState<Group>(empty);
 const [content,setContent]=useState<Group>(empty);
 const [loading,setLoading]=useState(false);
 const revision=useRef(0);
 const invalidate=useCallback(()=>{revision.current++;},[]);
 const [paging,setPaging]=useState<string|null>(null);
 useEffect(()=>{
  invalidate();
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   const term=query.trim();setKeyword(term);setTitle(empty());setContent(empty());
   if(!term){setLoading(false);return;}
   setLoading(true);
   void Promise.all([listSessions(controller.signal,{archived:true,search:term,search_in:"title"}),listSessions(controller.signal,{archived:true,search:term,search_in:"content"})]).then(([a,b])=>{if(controller.signal.aborted)return;setTitle({items:a.items,cursor:a.next_cursor??null});setContent({items:b.items,cursor:b.next_cursor??null});}).catch(reason=>{if(!controller.signal.aborted)notifyRequestError(reason,"搜索归档会话失败");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },300);
  return ()=>{invalidate();clearTimeout(timer);controller.abort();};
 },[query,invalidate]);
 async function more(kind:"title"|"content",group:Group){
  if(!group.cursor || paging)return;
  const term=keyword;const version=revision.current;setPaging(kind);
  try{const result=await listSessions(undefined,{archived:true,search:term,search_in:kind,cursor:group.cursor});
   if(version!==revision.current)return;
   (kind==="title"?setTitle:setContent)(previous=>({items:[...previous.items,...result.items.filter(item=>!previous.items.some(old=>old.id===item.id))],cursor:result.next_cursor??null}));
  }catch(reason){notifyRequestError(reason,"加载搜索结果失败");}finally{setPaging(null);}
 }
 return <Modal isOpen onOpenChange={open=>{if(!open)onClose();}}><Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
  <Modal.Header><Modal.Heading>搜索归档会话</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
  <Modal.Body className="max-h-[70vh] overflow-y-auto">
   <SearchField aria-label="搜索归档会话标题和内容" value={query} onChange={setQuery} autoFocus>
    <SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="搜索标题或消息内容" maxLength={200} /><SearchField.ClearButton aria-label="清除搜索" /></SearchField.Group>
   </SearchField>
   {loading?<Spinner aria-label="搜索中" />:!keyword?<p>输入关键词搜索归档会话。</p>:<div className="flex flex-col gap-3">{([{kind:"title",label:"标题匹配",group:title},{kind:"content",label:"内容匹配",group:content}] as const).map(({kind,label,group})=><section key={kind} className="flex flex-col gap-2" aria-label={label}>
    <h3>{label}</h3>
    {!group.items.length && <p className="text-sm text-muted">无匹配结果</p>}
    {kind==="content" && group.items.length>0 && <p className="text-xs text-muted">每个会话最多展示 5 条匹配消息片段</p>}
    {group.items.flatMap(session=>{
     const employee=employees.find(item=>item.id===session.employee_id)??{id:session.employee_id,title:"已卸载或不可用员工",description:""};
     const hits=kind==="title"?[{id:"title",role:"",excerpt:session.title}]:(session.search_hits??[]);
     return hits.map(hit=><Button key={`${session.id}:${hit.id}`} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" isDisabled={Boolean(session.deletion_status)} onPress={()=>onView(session)}>
      <AgentEmployeeAvatar employee={employee} />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
       <span className="w-full break-words text-sm"><HighlightedText text={hit.excerpt} keyword={keyword} /></span>
       <span className="max-w-full truncate text-xs text-muted">{kind==="content"?`${session.title} · ${hit.role==="user"?"用户消息":"AI 回复"} · `:""}{employee.title}</span>
      </span>
     </Button>);
    })}
    {group.cursor && <Button variant="ghost" isPending={paging===kind} isDisabled={Boolean(paging) || query.trim()!==keyword} onPress={()=>void more(kind,group)}>加载更多</Button>}
   </section>)}</div>}
  </Modal.Body>
 </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
