export interface NetworkProxyConfig {
  enabled: boolean;
  protocol: 'HTTP' | 'HTTPS' | 'SOCKS5';
  host: string;
  port: number;
  authEnabled?: boolean;
  username?: string;
  password?: string;
  bypassList: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic-native';
  baseUrl: string;
  apiKey: string;
  proxy?: {
    enabled: boolean;
    mode: 'inherit' | 'custom' | 'direct';
    customConfig?: Partial<NetworkProxyConfig>;
  };
}

export interface ModelMetadata {
  id: string;
  name: string;
  contextWindow: number;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
}

export interface QuestionPrompt {
  id: string;
  question: string;
  header: string;
  options: Array<{ label: string; description?: string }>;
  multiple?: boolean;
}

export interface QuestionRequest {
  requestID: string;
  sessionID: string;
  questions: QuestionPrompt[];
  createdAt: number;
}
