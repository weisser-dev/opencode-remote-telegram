// ─── Core types ───────────────────────────────────────────────────────────────

export type ProjectSource = 'folder' | 'desktop';

export interface ProjectConfig {
  alias: string;
  path: string;
  source: ProjectSource;
}

/** Rich project info from the OpenCode Desktop state file. */
export interface DesktopProjectInfo extends ProjectConfig {
  iconColor?: string;
  createdAt?: number;
  updatedAt?: number;
  pinned: boolean;
  isLastActive: boolean;
  lastSessionId?: string;
  lastSessionAt?: number;
}

/** A recent session from OpenCode Desktop. */
export interface DesktopSessionInfo {
  alias: string;
  path: string;
  sessionId: string;
  lastActiveAt: number;
  isLastActive: boolean;
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
  /** @deprecated Use projectsBasePaths instead. Kept for backward compat. */
  projectsBasePath?: string;
  /** Multiple base directories whose subdirectories are discovered as projects. */
  projectsBasePaths?: string[];
  openCodeConfigPath?: string;
  useGlobalConfig: boolean;
  /** Enable auto-discovery of projects from the OpenCode Desktop app. */
  discoverDesktopProjects?: boolean;
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
