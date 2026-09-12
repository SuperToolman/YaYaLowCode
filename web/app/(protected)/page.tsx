import { apps } from "../lib/apps";
import { HomePageClient } from "../components/HomePageClient";

export default function Home() {
  return <HomePageClient initialApps={apps} />;
}
