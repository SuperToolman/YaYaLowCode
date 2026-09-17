export {
  approveWorkflowTask,
  listWorkflowNotifications,
  listWorkflowTasks,
  readWorkflowNotification,
  rejectWorkflowTask,
} from "@/app/lib/api-client";
import { requestApi } from "@lib/api-request";

export function getWorkflowNotificationPreferences<T>() {
  return requestApi<T>("/api/workflow/notification-preferences", { cache: "no-store" });
}
