// Next development tooling owns this contract; it is not a deployed Rust API.
export type PackagePlatform = "linux/amd64" | "linux/arm64";
export type PlatformPackageDeployment = {
  webPort: number;
  apiPort: number;
  volumes: { key: string; destination: string }[];
  environment: { name: string; required: boolean; default?: string }[];
};
export type PlatformPackageJob = {
  id: string;
  version: string;
  runtimeHash: string;
  platform: PackagePlatform;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  message: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  error?: string;
  result?: { filename: string; path: string; version: string; packageId: string; imageId: string; platform: string; size: number };
};
export type PlatformPackageState = {
  version: string | null;
  outputDirectory: string;
  deployment: PlatformPackageDeployment;
  runtimeHash: string;
  ready: boolean;
  reason?: string;
  job: (PlatformPackageJob & { logs: string }) | null;
};
