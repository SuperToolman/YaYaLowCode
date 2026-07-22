import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormsByRouteAppId, isRuntimeAppId } from "../../lib/apps";

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
  let defaultForm: string | undefined =
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
        const defaultEntry = payload.data.find((item) => item.isDefaultEntry);
        defaultForm =
          (defaultEntry?.itemType === "form"
            ? defaultEntry.targetFormUuid
            : defaultEntry?.pathSlug) ??
          payload.data.find((item) => item.itemType === "form")?.targetFormUuid ??
          "todo";
      }
    } catch {
      // Runtime applications always provide the built-in todo page as an entry fallback.
    }

    defaultForm ??= "todo";
  }

  if (defaultForm) {
    redirect(`/${routeAppId}/${defaultForm}`);
  }

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center p-6">
      <div className="theme-panel-strong w-full max-w-[560px] rounded-xl p-8 text-center shadow-[var(--shadow-sm)]">
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">应用还没有页面</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
          当前应用下还没有可访问的表单。请先在应用内创建表单，再从这里访问。
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/myApp"
            className="inline-flex h-10 items-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-text-on-primary)] transition-colors hover:brightness-95"
          >
            返回我的应用
          </Link>
        </div>
      </div>
    </div>
  );
}
