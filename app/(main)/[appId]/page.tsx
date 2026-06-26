import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormsByRouteAppId, isRuntimeAppId } from "../../lib/apps";
import { SYSTEM_PAGES } from "../../lib/system-pages";

type NavigationItem = {
  itemType: string;
  targetFormUuid?: string | null;
  isDefaultEntry: boolean;
  pathSlug: string;
};

export default async function AppEntryPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId: routeAppId } = await params;
  const defaultSystemPage = SYSTEM_PAGES[0]?.slug;
  let defaultForm: string | undefined =
    defaultSystemPage ??
    getFormsByRouteAppId(routeAppId).find((form) => form.active)?.id ??
    getFormsByRouteAppId(routeAppId)[0]?.id;

  if (!defaultForm && isRuntimeAppId(routeAppId)) {
    try {
      const backendBaseUrl =
        process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";
      const response = await fetch(
        `${backendBaseUrl}/api/apps/${routeAppId}/navigation`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        code: number;
        data: NavigationItem[] | null;
      };
      if (payload.code === 0 && payload.data) {
        defaultForm =
          payload.data.find((item) => item.isDefaultEntry)?.targetFormUuid ??
          payload.data.find((item) => item.isDefaultEntry)?.pathSlug ??
          payload.data.find((item) => item.itemType === "form")?.targetFormUuid ??
          payload.data[0]?.pathSlug ??
          undefined;
      }
    } catch {
      defaultForm = undefined;
    }
  }

  if (defaultForm) {
    redirect(`/${routeAppId}/${defaultForm}`);
  }

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-[#dfe7f3] bg-white p-8 text-center shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
        <h1 className="text-2xl font-semibold text-[#14213d]">应用还没有页面</h1>
        <p className="mt-3 text-sm leading-6 text-[#5f718e]">
          当前应用下还没有可访问的表单。请先在应用内创建表单，再从这里访问。
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/myApp"
            className="inline-flex h-10 items-center rounded-lg bg-[#2f6bff] px-4 text-sm font-medium text-white transition-colors hover:bg-[#245be6]"
          >
            返回我的应用
          </Link>
        </div>
      </div>
    </div>
  );
}
