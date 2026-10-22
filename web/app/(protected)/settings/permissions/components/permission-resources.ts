import { getAiEmployees } from "@features/settings/api";
import type {
  Agent,
  AiEmployeeMarketItem,
  ApiEnvelope,
} from "./permission-types";
export async function listAiEmployeePermissionAgents(): Promise<{
  data?: ApiEnvelope<Agent[]>;
  error?: unknown;
}> {
  try {
    const employees = await getAiEmployees();
    return {
      data: {
        code: 0,
        message: "",
        data: employees
          .filter((item) => item.installed)
          .map((item) => ({
            id: item.id,
            name: item.title,
            description: "AI 员工使用权限",
            enabled:
              !item.expiresAt ||
              item.expiresAt >= Math.floor(Date.now() / 1000),
          })),
      },
    };
  } catch (error) {
    return { error, data: undefined };
  }
}
