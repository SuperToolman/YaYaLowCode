export type ApiEnvelope<T> = { code: number; message: string; data: T | null };

export type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  scopeType: "platform" | "application" | "business";
  scopeRefId?: string;
  profileId: string;
  systemPrompt: string;
  pluginIds: string[];
  skillIds: string[];
  knowledgeBaseIds: string[];
};

export type AgentModelProvider = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
};

export type AgentConfigProfile = {
  id: string;
  name: string;
  providerId: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxSteps: number;
  maxRetries: number;
  imageCaptionModel: string;
  personaId: string;
  webSearchEnabled: boolean;
  contextMaxTurns: number;
  contextDiscardTurns: number;
  contextOverflowStrategy: string;
  contextCompressionPrompt: string;
  contextKeepRecentRatio: number;
  contextCompressionProviderId?: string;
  maxContextTokens: number;
  pluginIds: string[];
  skillIds: string[];
  knowledgeBaseIds: string[];
};

export type AgentPersona = { id: string; name: string; description: string; systemPrompt: string };

export type AgentPlugin = { id: string; name: string; description: string; enabled: boolean; version: string; entrypoint: string; requiresConfirmation: boolean };
export type AgentSkill = { id: string; name: string; description: string; enabled: boolean; allowedTools: string[]; requiresConfirmation: boolean };
export type AgentKnowledgeBase = { id: string; name: string; description: string; enabled: boolean; retrievalMode: string; sourceIds: string[] };
