import { apps } from "../../features/application/types";
import { HomePageClient } from "../_components/HomePageClient";

export default function Home() {
  return <HomePageClient initialApps={apps} />;
}
