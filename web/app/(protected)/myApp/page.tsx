import { apps } from "@/app/lib/apps";
import { MyAppPageClient } from "./components/MyAppPageClient";

export default function MyAppPage() {
  return <MyAppPageClient initialApps={apps} />;
}
