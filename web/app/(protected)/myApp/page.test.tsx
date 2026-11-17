import {render,screen,within,cleanup,fireEvent,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import Page from "./page";
const mocks=vi.hoisted(()=>({apps:vi.fn(),sync:vi.fn(),capabilities:vi.fn(),permission:vi.fn()}));
vi.mock("@/features/application/api",()=>({listApps:mocks.apps,syncMarketplaceApplications:mocks.sync,getMarketPublicationCapabilities:mocks.capabilities}));
vi.mock("@/features/auth/components/AuthProvider",()=>({useAuth:()=>({hasPermission:mocks.permission,user:{id:"admin",displayName:"管理员"}})}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("@/features/form-designer/components/FieldOutlineModal",()=>({FieldOutlineModal:()=>null}));
vi.mock("@/features/application/components/MarketSubmissionsDialog",()=>({MarketSubmissionsDialog:()=> <div role="dialog" aria-label="上线申请记录"/>}));
vi.mock("@/features/application/components/MarketPublishDialog",()=>({MarketPublishDialog:()=>null}));
const app=(id:string,extra:Record<string,unknown>={})=>({id,name:id,desc:"",icon:"",color:"primary",owner:"管理员",createdAt:"2026-11-16",records:0,deploymentType:"local",...extra});
beforeEach(()=>{mocks.permission.mockReturnValue(true);mocks.capabilities.mockResolvedValue({enabled:true,canPublish:true});vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});mocks.sync.mockImplementation(()=>new Promise(()=>{}));mocks.apps.mockResolvedValue({data:{code:0,message:"ok",data:[app("开发者源应用",{deploymentType:"online"}),app("独立应用",{deploymentType:"market",marketInstallationId:"single",marketApplicationType:"single"}),app("B副本一",{deploymentType:"market",marketInstallationId:"one",marketProductName:"完整套件",marketApplicationType:"suite"}),app("C副本一",{deploymentType:"market",marketInstallationId:"one",marketProductName:"完整套件",marketApplicationType:"suite"}),app("B副本二",{deploymentType:"market",marketInstallationId:"two",marketProductName:"精简套件",marketApplicationType:"suite"})]},response:new Response()});});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
it("loads local apps without waiting for operations and separates purchased singles and suites",async()=>{
 render(<Page/>);await screen.findByText("B副本一");
 const local=screen.getByRole("region",{name:"本地应用"});expect(within(local).getByText("开发者源应用")).toBeTruthy();
 const single=screen.getByRole("region",{name:"购买应用"});expect(within(single).getByText("独立应用")).toBeTruthy();
 const suite=screen.getByRole("region",{name:"套应用：完整套件"});expect(within(suite).getByText("B副本一")).toBeTruthy();expect(within(suite).getByText("C副本一")).toBeTruthy();expect(within(suite).queryByText("B副本二")).toBeNull();
 expect(within(screen.getByRole("region",{name:"套应用：精简套件"})).getByText("B副本二")).toBeTruthy();
});

it.each([
  { enabled: false, administrator: true, visible: false },
  { enabled: true, administrator: false, visible: false },
  { enabled: true, administrator: true, visible: true },
])("publication menus obey environment=$enabled administrator=$administrator", async ({enabled,administrator,visible}) => {
  mocks.permission.mockImplementation((permission: string) => permission === "*" ? administrator : true);
  mocks.capabilities.mockResolvedValue({ enabled, canPublish: enabled && administrator });
  render(<Page />);
  await screen.findByRole("button", { name: "开发者源应用 更多操作" });
  if (administrator) await waitFor(() => expect(mocks.capabilities).toHaveBeenCalled());
  await waitFor(() => expect(Boolean(screen.queryByRole("button", { name: "上线申请记录" }))).toBe(visible));
  fireEvent.click(screen.getByRole("button", { name: "开发者源应用 更多操作" }));
  await screen.findByRole("menuitem", { name: "编辑应用" });
  expect(Boolean(screen.queryByRole("menuitem", { name: "上线申请" }))).toBe(visible);
  expect(Boolean(screen.queryByRole("menuitem", { name: "导出应用包（ZIP）" }))).toBe(visible);
  expect(screen.queryByRole("button", { name: "独立应用 更多操作" })).toBeNull();
  expect(screen.queryByRole("button", { name: "B副本一 更多操作" })).toBeNull();
});

it("keeps publication hidden when capability discovery fails", async () => {
  mocks.capabilities.mockRejectedValue(new Error("offline"));
  render(<Page />);
  await screen.findByRole("button", { name: "开发者源应用 更多操作" });
  fireEvent.click(screen.getByRole("button", { name: "开发者源应用 更多操作" }));
  await screen.findByRole("menuitem", { name: "编辑应用" });
  expect(screen.queryByRole("menuitem", { name: "上线申请" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "导出应用包（ZIP）" })).toBeNull();
});

it("opens submission history from the button before the field outline",async()=>{
 render(<Page/>);
 const button=await screen.findByRole("button",{name:"上线申请记录"});
 const outline=screen.getByRole("button",{name:"字段大纲"});
 expect(button.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(button);expect(await screen.findByRole("dialog",{name:"上线申请记录"})).toBeTruthy();
});
