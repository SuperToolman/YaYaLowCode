import type { CreateClientConfig } from "./api-client/client.gen";
import { controlledFetch } from "./api-request";

export const createClientConfig: CreateClientConfig = (override) => ({ ...override, fetch: controlledFetch });
