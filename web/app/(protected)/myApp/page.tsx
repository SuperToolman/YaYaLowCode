import { apps } from "@/features/application/types";
import { MyAppPageClient } from "./components/MyAppPageClient";

export default function MyAppPage() {
  return <MyAppPageClient initialApps={apps} />;
}
