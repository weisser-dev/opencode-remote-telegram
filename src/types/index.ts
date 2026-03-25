// ─── Core types ───────────────────────────────────────────────────────────────

export interface ProjectConfig {
  alias: string;
  path: string;
}

export interface ThreadSession {
  threadId: string;
  sessionId: string;
  projectPath: string;
  port: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface BotConfig {
  telegramToken: string;
  allowedUserIds: number[];
  projectsBasePath?: string;
  openCodeConfigPath?: string;
  useGlobalConfig: boolean;
}

export interface QueueSettings {
  continueOnFailure: boolean;
}

export interface QueueItem {
  threadId: string;
  chatId: number;
  topicId?: number;
  text: string;
  parentChatId?: number;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface SSEEvent {
  type: string;
  properties: unknown;
}

export interface SessionErrorInfo {
  name: string;
  data?: {
    message?: string;
  };
}

export interface MessageUsageInfo {
  sessionID: string;
  messageID: string;
  cost: number;
  tokens: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  modelID?: string;
  providerID?: string;
  duration?: number;
}
