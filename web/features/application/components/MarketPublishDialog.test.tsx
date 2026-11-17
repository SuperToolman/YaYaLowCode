import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketPublishDialog } from "./MarketPublishDialog";
const mocks = vi.hoisted(() => ({ preflight: vi.fn(), previous: vi.fn(), submit: vi.fn(), export: vi.fn(), download: vi.fn(), apps: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { success: mocks.success, warning: mocks.warning }, notifyRequestError: (_error: unknown, title: string) => mocks.error(title) }));
vi.mock("../api", () => ({ preflightMarketPublication: mocks.preflight, getMarketplaceSubmission: mocks.previous, submitAppToMarketplace: mocks.submit, exportApplicationPackage: mocks.export, downloadApplicationPackage: mocks.download, listApps: mocks.apps }));
const check = { fingerprint: "snapshot-1", applicationType: "suite", selectedAppIds: ["a"], members: [{ appId: "a", name: "销售" }, { appId: "b", name: "客户" }], dependencies: [{ sourceAppId: "a", targetAppId: "b", path: "/fields/client", resourceId: "client-form" }], resourceSummary: { forms: 2 }, blockingIssues: [], configurationRequired: ["安装后配置访问权限"] };
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); mocks.preflight.mockResolvedValue(check); mocks.previous.mockResolvedValue({ productId: "product-1", status: "rejected", reviewReason: "补充说明", snapshot: { commercial: { pricingMode: "free",priceCents:0,publisherRateBasisPoints:0,currency:"CNY",licenseModel:"one_time",description:"套应用说明" } } }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("confirms the complete suite and sends the fingerprint with an explicit new-product choice", async () => {
  mocks.submit.mockResolvedValue({});
  render(<MarketPublishDialog appId="a" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  await waitFor(() => expect(screen.getByRole("button", { name: "确认整包提交" }).hasAttribute("disabled")).toBe(false));
  expect(mocks.warning).toHaveBeenCalledWith("上次上线申请未通过审核", { description: "补充说明" });
  expect(screen.queryByText(/上次申请：/)).toBeNull();
  expect(within(screen.getByLabelText("基础信息")).getByRole("textbox", { name: "套应用名称" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "商品说明" })).toHaveProperty("required", true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "确认整包提交" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith("a", { fingerprint: "snapshot-1", selectedAppIds: ["a"], productId: null, newProduct: true, packageName: "未命名套应用", commercial: { pricingMode: "free", priceCents: 0, publisherRateBasisPoints: 0, currency: "CNY", licenseModel: "one_time", description: "套应用说明" } }));
  expect(await screen.findByText(/通过后由运营另行上架/)).toBeTruthy();
});
it("blocks submission for an inaccessible dependency and displays its exact location", async () => {
  mocks.preflight.mockResolvedValue({ ...check, blockingIssues: [{ appId: "b", path: "/fields/client", message: "没有发布此成员应用的权限" }] });
  render(<MarketPublishDialog appId="a" onClose={vi.fn()} />);
  await screen.findByText(/没有发布此成员应用的权限/);
  expect(screen.getByRole("button", { name: "确认整包提交" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("retains a failed submission for retry and lets the user refresh a changed snapshot", async () => {
  mocks.submit.mockRejectedValue(new Error("应用结构或依赖已变化，请重新预检确认"));
  render(<MarketPublishDialog appId="a" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  await waitFor(() => expect(screen.getByRole("button", { name: "确认整包提交" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "确认整包提交" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("应用结构或依赖已变化，请重新预检确认"));
  mocks.preflight.mockResolvedValue({ ...check, fingerprint: "snapshot-2" });
  fireEvent.click(screen.getByRole("button", { name: "重新预检" }));
  await waitFor(() => expect(mocks.preflight).toHaveBeenCalledTimes(2));
});

it("exports the confirmed complete suite without submitting an online application", async () => {
  mocks.export.mockResolvedValue(undefined);
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  expect(mocks.previous).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("包版本号"), { target: { value: "1.0.2" } });
  fireEvent.click(screen.getByRole("button", { name: "导出应用包（ZIP）" }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledWith("a", "snapshot-1", "1.0.2", "未命名套应用", ["a"], { submissionType: "new_listing" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  await screen.findByText(/应用包已导出/);
});

it("submits paid suite price and requested revenue share in integer cents and basis points", async () => {
  mocks.submit.mockResolvedValue({}); render(<MarketPublishDialog appId="a" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("radio", { name: "一次买断" }));
  fireEvent.change(screen.getByLabelText("整包售价"), { target: { value: "199.01" } });
  fireEvent.change(screen.getByLabelText("发布者分成"), { target: { value: "75.25" } });
  fireEvent.click(screen.getByRole("button", { name: "确认整包提交" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith("a", expect.objectContaining({ commercial: expect.objectContaining({priceCents:19901,publisherRateBasisPoints:7525,pricingMode:"paid"}) })));
});
it("does not publish missing or invalid commercial information", async () => {
  render(<MarketPublishDialog appId="a" onClose={vi.fn()} />); await screen.findByTitle("b");
  fireEvent.change(screen.getByLabelText("商品说明"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "确认整包提交" })); await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("请填写商品说明")); expect(mocks.submit).not.toHaveBeenCalled();
});

it("shows a readable duplicate location and advice with technical IDs in expandable details", async () => {
  mocks.preflight.mockResolvedValue({ ...check, blockingIssues: [{ appId:"a", path:"/resources/form_views/1", message:"表单「客户」 → 表单视图「全部数据」在打包清单中出现重复配置", location:"表单「客户」 → 表单视图「全部数据」", suggestion:"不要删除表单或业务数据，请联系管理员排查。",resourceId:"default",previousPath:"/resources/form_views/0" }] });
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()} />);
  expect(await screen.findByText("表单「客户」 → 表单视图「全部数据」")).toBeTruthy();
  expect(screen.getByText(/处理建议：不要删除表单或业务数据/)).toBeTruthy();
  expect(screen.getByText("供管理员排查的详细信息")).toBeTruthy();
  expect(screen.getByRole("button",{name:"导出应用包（ZIP）"}).hasAttribute("disabled")).toBe(true);
});

it("requires a suite name and includes a custom name in ZIP export",async()=>{
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()}/>);
  const name=await screen.findByRole("textbox",{name:"套应用名称"});
  fireEvent.change(name,{target:{value:""}});fireEvent.click(screen.getByRole("button",{name:"导出应用包（ZIP）"}));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("请填写套应用名称"));expect(mocks.export).not.toHaveBeenCalled();
  fireEvent.change(name,{target:{value:"客户经营套件"}});fireEvent.click(screen.getByRole("button",{name:"重试导出"}));
  await waitFor(()=>expect(mocks.export).toHaveBeenCalledWith("a","snapshot-1","1.0.0","客户经营套件",["a"], { submissionType: "new_listing" }));
});


it("shows immediate progress, prevents repeat submission, and displays the immutable receipt", async () => {
  let complete!: (value: unknown) => void;
  mocks.submit.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<MarketPublishDialog appId="a" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("button", { name: "确认整包提交" }));
  expect(await screen.findByRole("progressbar", { name: "打包上传处理中" })).toBeTruthy();
  const running = screen.getByRole("button", { name: "打包上传中…" });
  expect(running.hasAttribute("disabled")).toBe(true);
  fireEvent.click(running);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "关闭" }).hasAttribute("disabled")).toBe(true);
  complete({submissionId: "sub-result", version: "1.0.3", status: "pending_review"});
  expect(await screen.findByText("上线申请提交成功")).toBeTruthy();
  expect(screen.getByText("申请编号：sub-result")).toBeTruthy();
  expect(screen.getByText("申请版本：1.0.3")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByRole("button", {name: "确认整包提交"})).toBeNull();
});

it("shows export progress, reports filename and size, and downloads again without repackaging", async () => {
  const file = {filename: "客户经营.zip", size: 2048, blob: new Blob(["zip"])};
  let complete!: (value: unknown) => void;
  mocks.export.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("button", { name: "导出应用包（ZIP）" }));
  expect(await screen.findByRole("progressbar", {name: "导出处理中"})).toBeTruthy();
  complete(file);
  expect(await screen.findByText("应用包导出成功")).toBeTruthy();
  expect(screen.getByText("文件：客户经营.zip")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "再次下载 ZIP"}));
  expect(mocks.download).toHaveBeenCalledWith(file);
  expect(mocks.export).toHaveBeenCalledTimes(1);
});

it("shows the failure beside the confirmation controls and lets the original request be retried", async () => {
  mocks.export.mockRejectedValueOnce(new Error("应用结构或依赖已变化，请重新预检确认"));
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()} />);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("button", {name: "导出应用包（ZIP）"}));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("应用结构或依赖已变化，请重新预检确认"));
  expect(screen.queryByRole("alert")).toBeNull();
  mocks.export.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", {name: "重试导出"}));
  await screen.findByText("应用包导出成功");
  expect(mocks.export).toHaveBeenCalledTimes(2);
});


it.each(["publish", "export"] as const)("adds independent members and their dependencies for %s", async (mode) => {
  mocks.preflight.mockResolvedValueOnce({...check, applicationType:"single", members:[check.members[0]], dependencies:[]});
  mocks.apps.mockResolvedValue({data:{code:0,message:"ok",data:[
    {id:"a",name:"销售",deploymentType:"local"},
    {id:"d",name:"独立报表",deploymentType:"local"},
    {id:"e",name:"报表字典",deploymentType:"local"},
    {id:"installed",name:"已购副本",deploymentType:"market",marketInstallationId:"installation"}
  ]},response:new Response()});
  const expanded={...check,selectedAppIds:["a","d"],members:[check.members[0],{appId:"d",name:"独立报表"},{appId:"e",name:"报表字典"}],dependencies:[{sourceAppId:"d",targetAppId:"e",path:"/field",resourceId:"form-e"}]};
  mocks.preflight.mockResolvedValue(expanded);
  mocks.submit.mockResolvedValue({status:"pending_review"});mocks.export.mockResolvedValue(undefined);
  render(<MarketPublishDialog appId="a" mode={mode} onClose={vi.fn()}/>);
  await screen.findByTitle("a");
  expect(screen.queryByRole("textbox",{name:"套应用名称"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"选择成员应用"}));
  expect(await screen.findByRole("checkbox",{name:"独立报表"})).toBeTruthy();
  expect(screen.queryByRole("checkbox",{name:"已购副本"})).toBeNull();
  fireEvent.click(screen.getByRole("checkbox",{name:"独立报表"}));
  await waitFor(()=>expect(mocks.preflight).toHaveBeenLastCalledWith("a",["a","d"]));
  await screen.findByTitle("d");
  expect(screen.getByRole("dialog", {name:"选择成员应用"})).toBeTruthy();
  expect(screen.getByRole("checkbox",{name:"报表字典（必要依赖，自动包含）"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", {name:"完成"}));
  await waitFor(() => expect(screen.queryByRole("dialog", {name:"选择成员应用"})).toBeNull());
  expect(screen.getByRole("textbox",{name:"套应用名称"})).toBeTruthy();
  if(mode==="publish") {
    fireEvent.click(screen.getByRole("button",{name:"确认整包提交"}));
    await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith("a",expect.objectContaining({selectedAppIds:["a","d"]})));
  } else {
    fireEvent.click(screen.getByRole("button",{name:"导出应用包（ZIP）"}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalledWith("a","snapshot-1","1.0.0","未命名套应用",["a","d"], { submissionType: "new_listing" }));
  }
});

it("removes only a manual selection and rechecks the resulting dependency closure",async()=>{
  mocks.apps.mockResolvedValue({data:{code:0,message:"ok",data:[{id:"d",name:"独立报表",deploymentType:"local"}]},response:new Response()});
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()}/>);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("button",{name:"选择成员应用"}));
  fireEvent.click(await screen.findByRole("checkbox",{name:"独立报表"}));
  await screen.findByRole("checkbox",{name:"独立报表（已选择）"});
  fireEvent.click(screen.getByRole("checkbox",{name:"独立报表（已选择）"}));
  await waitFor(()=>expect(mocks.preflight).toHaveBeenLastCalledWith("a",["a"]));
});


it("lets the initiating card application be deselected after another equal member is chosen",async()=>{
  mocks.preflight.mockResolvedValueOnce({...check, applicationType:"single", members:[check.members[0]], dependencies:[]});
  mocks.apps.mockResolvedValue({data:{code:0,message:"ok",data:[{id:"a",name:"销售",deploymentType:"local"},{id:"d",name:"独立报表",deploymentType:"local"}]},response:new Response()});
  mocks.preflight.mockResolvedValueOnce({...check,selectedAppIds:["a","d"],members:[check.members[0],{appId:"d",name:"独立报表"}],dependencies:[]});
  mocks.preflight.mockResolvedValueOnce({...check,applicationType:"single",selectedAppIds:["d"],members:[{appId:"d",name:"独立报表"}],dependencies:[]});
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()}/>);
  await screen.findByTitle("a");
  fireEvent.click(screen.getByRole("button",{name:"选择成员应用"}));
  fireEvent.click(await screen.findByRole("checkbox",{name:"独立报表"}));
  await screen.findByTitle("d");
  fireEvent.click(screen.getByRole("checkbox",{name:"销售（已选择）"}));
  await waitFor(()=>expect(mocks.preflight).toHaveBeenLastCalledWith("a",["d"]));
  expect(await screen.findByRole("checkbox",{name:"独立报表（已选择）"})).toHaveProperty("disabled",true);
  expect(screen.queryByText("入口应用")).toBeNull();
  expect(screen.queryByRole("textbox",{name:"套应用名称"})).toBeNull();
});

it("marks an exported upgrade with its explicit target product",async()=>{
  mocks.export.mockResolvedValue(undefined);
  render(<MarketPublishDialog appId="a" mode="export" onClose={vi.fn()}/>);
  await screen.findByTitle("b");
  fireEvent.click(screen.getByRole("radio",{name:"版本升级"}));
  fireEvent.click(screen.getByRole("button",{name:"导出应用包（ZIP）"}));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("请填写升级目标商品编号"));expect(mocks.export).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("目标商品编号"),{target:{value:"prod_existing"}});
  fireEvent.click(screen.getByRole("button",{name:"重试导出"}));
  await waitFor(()=>expect(mocks.export).toHaveBeenCalledWith("a","snapshot-1","1.0.0","未命名套应用",["a"],{submissionType:"version_upgrade",targetProductId:"prod_existing"}));
});
