import type { NetworkProxyConfig } from '@harness/protocol';
export declare class SilentZombieTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(timeoutMs: number);
}
export interface DispatcherOptions {
    globalProxy: NetworkProxyConfig;
    silentTimeoutMs?: number;
}
export interface RouteResolution {
    useProxy: boolean;
    proxyUrl?: string;
    protocol?: string;
    host?: string;
    port?: number;
    auth?: {
        username?: string;
        password?: string;
    };
}
export interface ProviderProxyOption {
    enabled: boolean;
    mode: 'inherit' | 'custom' | 'direct';
    customConfig?: {
        protocol?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
    };
}
export declare class ProxyDispatcher {
    private globalProxy;
    private silentTimeoutMs;
    private readonly dispatcherCache;
    constructor(options: DispatcherOptions);
    getGlobalProxy(): NetworkProxyConfig;
    updateGlobalProxy(config: NetworkProxyConfig): void;
    shouldBypass(targetUrl: string): boolean;
    resolveRoute(targetUrl: string, providerProxy?: ProviderProxyOption): RouteResolution;
    /**
     * 针对流式路由构建带代理的 RequestInit 配置；dispatcher 为共享单例，
     * 防止每次 LLM 调用都泄漏一个 undici 连接池（长运行 OOM 根因，TC-00-99-003）。
     */
    fetchWithProxy(targetUrl: string, init?: RequestInit, providerProxy?: ProviderProxyOption): Promise<Response>;
    /**
     * 取同一路由的共享 ProxyAgent 单例；相同 (proxyUrl + 凭据) 复用同一连接池。
     */
    getSharedDispatcher(route: RouteResolution): Promise<unknown>;
    /** 销毁指定共享 dispatcher 并移除缓存（配置变更时调用）。 */
    destroyDispatcher(dispatcher: unknown): Promise<void>;
    /** 服务停止时销毁全部共享 dispatcher，释放所有代理连接池。 */
    destroyAll(): Promise<void>;
    wrapStreamWithTimeout<T>(stream: AsyncIterable<T>): AsyncIterable<T>;
}
