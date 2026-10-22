import { describe, it, expect } from "vitest";
import { emptyDraft, changeTarget, writableFields, conditionFields, validateDraft, buttonPageUrl, type SchemaField } from "./model";
const fields: SchemaField[] = [{id:"text",type:"singleLineText",label:"名称"},{id:"computed",type:"number",props:{isReadOnly:true}},{id:"serial",type:"serialNumber"},{id:"group",type:"groupContainer"},{id:"createdAt",type:"date"}];
function configured() { const draft=emptyDraft();draft.name="按钮";draft.actionConfig={targetAppId:"app",targetFormUuid:"form",fieldIds:["text"]};return draft; }
describe("按钮配置契约",()=>{
  it("集成自动化动作仅要求绑定自动化，不要求填写目标",()=>{
    const draft=emptyDraft(); draft.name="执行"; draft.actionType="run_automation";
    expect(validateDraft(draft,[],false)).toBe("请选择集成自动化");
    draft.actionConfig.automationId="auto";
    expect(validateDraft(draft,[],false)).toBe("");
  });
  it("打开页面独立校验链接与打开方式，不要求填写字段",()=>{
    const draft=configured();draft.actionType="open_page";
    draft.actionConfig={targetAppId:"",targetFormUuid:"",fieldIds:[],linkType:"external",url:"https://example.com",openMode:"window"};
    expect(validateDraft(draft,[],false)).toBe("");
    draft.actionConfig.url="javascript:alert(1)";
    expect(validateDraft(draft,[],false)).toContain("http");
    draft.actionConfig={targetAppId:"app",targetFormUuid:"form",fieldIds:[],linkType:"internal",pageMode:"edit",openMode:"sidebar"};
    expect(validateDraft(draft,[],false)).toBe("");
    const button={...draft,id:"b",appId:"app",formUuid:"form",createdAt:"",updatedAt:""};
    expect(buttonPageUrl(button,"form","r1")).toBe("/app/form?buttonPageMode=edit&record=r1");
    expect(buttonPageUrl(button,"another","r1")).not.toContain("record=");
  });
  it("填写字段排除布局、计算和系统字段，条件可读系统字段",()=>{expect(writableFields(fields).map((f)=>f.id)).toEqual(["text"]);expect(conditionFields(fields,true).some((f)=>f.key==="workflowApprovalStatus")).toBe(true);expect(conditionFields(fields,false).some((f)=>f.key==="workflowApprovalStatus")).toBe(false);});
  it("更换填写对象清空字段，保留名称",()=>{const draft=configured();const next=changeTarget(draft,"other-app","other-form");expect(next.actionConfig.fieldIds).toEqual([]);expect(next.name).toBe("按钮");expect(draft.actionConfig.fieldIds).toEqual(["text"]);});
  it("按钮定义拥有统一可用条件",()=>{const draft=configured();expect(draft.availability).toEqual({mode:"all",rules:[]});expect(validateDraft(draft,fields,false)).toBe("");draft.actionConfig.fieldIds=["missing"];expect(validateDraft(draft,fields,false)).toContain("失效");});
});
