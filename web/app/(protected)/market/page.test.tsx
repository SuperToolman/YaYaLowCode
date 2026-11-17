import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import MarketPage from "./page";
const mocks=vi.hoisted(()=>({catalogue:vi.fn(),installations:vi.fn(),checkout:vi.fn(),pay:vi.fn(),install:vi.fn(),preflight:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/features/auth/components/AuthProvider",()=>({useAuth:()=>({hasPermission:()=>true,permissionsReady:true})}));
vi.mock("../settings/ai-employee-market/page",()=>({default:()=>null}));
vi.mock("@/shared/lib/notify",()=>({notify:{success:vi.fn(),info:vi.fn()},notifyRequestError:vi.fn()}));
vi.mock("@/features/application/api",()=>({listMarketplaceApplications:mocks.catalogue,listMarketplaceInstallations:mocks.installations,checkoutApplication:mocks.checkout,simulateApplicationPayment:mocks.pay,installMarketplaceApplication:mocks.install,preflightMarketplaceApplication:mocks.preflight}));
const product={productId:"suite",publisherAppId:"a",publisherOwned:false,name:"销售套件",description:"完整套应用",version:"1.0.0",releaseId:"r1",applicationType:"suite",members:[{appId:"a",name:"销售"},{appId:"b",name:"客户"}],commercialReady:true,commercialId:"price-v1",pricingMode:"paid",priceCents:19900,owned:false};
const order={orderId:"order-1",orderNo:"ORDER-1",productId:"suite",status:"pending_payment",amountCents:19900,snapshot:{name:"销售套件",description:"完整套应用"},owned:false,simulation:true};
beforeEach(()=>{vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});mocks.catalogue.mockResolvedValue([product]);mocks.installations.mockResolvedValue([]);mocks.checkout.mockResolvedValue(order);mocks.preflight.mockResolvedValue({alreadyInstalled:false,blockingIssues:[]});mocks.install.mockResolvedValue({});});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
it("paid applications open the shared payment dialog and only expose install after simulated payment",async()=>{
 render(<MarketPage/>);fireEvent.click(await screen.findByRole("button",{name:"立即购买"}));
 await waitFor(()=>expect(mocks.checkout).toHaveBeenCalledWith("suite","price-v1",expect.any(String)));
 expect(await screen.findByText("一次买断 · 整包权益 · 模拟支付")).toBeTruthy();expect(mocks.install).not.toHaveBeenCalled();
 mocks.catalogue.mockResolvedValue([{...product,owned:true}]);mocks.pay.mockResolvedValue({...order,status:"completed",owned:true});
 fireEvent.click(screen.getByRole("button",{name:"测试支付完成"}));
 await waitFor(()=>expect(mocks.pay).toHaveBeenCalledWith("order-1"));
 fireEvent.click(await screen.findByRole("button",{name:"安装"}));await waitFor(()=>expect(mocks.install).toHaveBeenCalledWith("suite"));
});
it("free claims automatically grant ownership without opening payment",async()=>{
 mocks.catalogue.mockResolvedValueOnce([{...product,pricingMode:"free",priceCents:0}]).mockResolvedValue([{...product,pricingMode:"free",priceCents:0,owned:true}]);mocks.checkout.mockResolvedValue({...order,status:"completed",amountCents:0,owned:true});
 render(<MarketPage/>);fireEvent.click(await screen.findByRole("button",{name:"免费领取"}));
 expect(await screen.findByRole("button",{name:"安装"})).toBeTruthy();expect(screen.queryByRole("button",{name:"测试支付完成"})).toBeNull();expect(mocks.pay).not.toHaveBeenCalled();
});
