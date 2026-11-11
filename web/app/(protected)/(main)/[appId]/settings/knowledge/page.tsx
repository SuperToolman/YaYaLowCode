import { AppSettingsLayout } from "../components/AppSettingsLayout";
import { Card } from "@heroui/react";
import { KnowledgeManager } from "@/features/knowledge/KnowledgeManager";

export default async function AppKnowledgePage({params}:{params:Promise<{appId:string}>}){
 const {appId}=await params;
 return <AppSettingsLayout appId={appId} selectedKey="knowledge"><main className="min-h-0 min-w-0"><Card className="h-full min-h-0"><Card.Header><Card.Title>应用知识库</Card.Title><Card.Description>管理当前应用的业务手册、规则说明和参考资料。</Card.Description></Card.Header><Card.Content className="min-h-0 overflow-y-auto overscroll-contain"><KnowledgeManager key={appId} kind="application" applicationId={appId}/></Card.Content></Card></main></AppSettingsLayout>;
}
