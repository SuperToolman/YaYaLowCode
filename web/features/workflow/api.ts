export {
  approveWorkflowTask,
  listWorkflowNotifications,
  listWorkflowTasks,
  readWorkflowNotification,
  rejectWorkflowTask,
} from "@/shared/lib/http";
import { getWorkflowNotificationPreferences as preferences } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";
export function getWorkflowNotificationPreferences() { return preferences().then(result => unwrapApiResult(result)); }
