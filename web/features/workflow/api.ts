export {
  approveWorkflowTask,
  listWorkflowNotifications,
  listWorkflowTasks,
  readWorkflowNotification,
  rejectWorkflowTask,
} from "@/app/lib/http";
import { getWorkflowNotificationPreferences as preferences } from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";
export function getWorkflowNotificationPreferences() { return preferences().then(result => unwrapApiResult(result)); }
