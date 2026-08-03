import { apps } from "./lib/apps";
import { MyAppPageClient } from "./components/my-app-page-client";

export default function Home() {
  return <MyAppPageClient initialApps={apps} />;
}
