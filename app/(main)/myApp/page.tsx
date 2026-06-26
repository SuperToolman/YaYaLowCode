import { apps } from "../../lib/apps";
import { MyAppPageClient } from "./my-app-page-client";

export default function MyAppPage() {
  return <MyAppPageClient initialApps={apps} />;
}
