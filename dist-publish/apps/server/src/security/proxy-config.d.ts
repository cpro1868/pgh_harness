export interface ProviderProxyCustomConfig {
    protocol: 'HTTP' | 'HTTPS' | 'SOCKS5';
    host: string;
    port: number;
    username?: string;
    password?: string;
}
export interface ProviderProxyConfig {
    enabled: boolean;
    mode: 'direct' | 'inherit' | 'custom';
    customConfig?: ProviderProxyCustomConfig;
}
export declare function sanitizeProxyConfig(raw: unknown): ProviderProxyConfig;
