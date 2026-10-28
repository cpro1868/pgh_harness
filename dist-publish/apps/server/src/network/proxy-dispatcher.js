export class SilentZombieTimeoutError extends Error {
    timeoutMs;
    constructor(timeoutMs) {
        super(`[NetworkProxy] Silent zombie connection detected: No new chunks received within ${timeoutMs}ms. Stream suspended.`);
        this.name = 'SilentZombieTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
export class ProxyDispatcher {
    globalProxy;
    silentTimeoutMs;
    dispatcherCache = new Map();
    constructor(options) {
        this.globalProxy = options.globalProxy;
        this.silentTimeoutMs = options.silentTimeoutMs ?? 45000;
    }
    getGlobalProxy() {
        return { ...this.globalProxy };
    }
    updateGlobalProxy(config) {
        this.globalProxy = config;
    }
    shouldBypass(targetUrl) {
        if (!this.globalProxy.bypassList)
            return false;
        try {
            const url = new URL(targetUrl);
            const host = url.hostname.toLowerCase();
            const bypasses = this.globalProxy.bypassList
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            for (const item of bypasses) {
                if (item === host)
                    return true;
                if (item.startsWith('*.')) {
                    const suffix = item.slice(2);
                    if (host.endsWith(suffix) || host === suffix)
                        return true;
                }
            }
            return false;
        }
        catch {
            return false;
        }
    }
    resolveRoute(targetUrl, providerProxy) {
        if (this.shouldBypass(targetUrl)) {
            return { useProxy: false };
        }
        // 1. Provider 专属代理模式
        if (providerProxy) {
            if (providerProxy.mode === 'direct' || !providerProxy.enabled) {
                return { useProxy: false };
            }
            if (providerProxy.mode === 'custom' && providerProxy.customConfig) {
                const proto = providerProxy.customConfig.protocol || 'HTTP';
                const host = providerProxy.customConfig.host || '127.0.0.1';
                const port = providerProxy.customConfig.port || 7890;
                const proxyUrl = `${proto.toLowerCase()}://${host}:${port}`;
                return {
                    useProxy: true,
                    proxyUrl,
                    protocol: proto,
                    host,
                    port,
                    auth: {
                        username: providerProxy.customConfig.username,
                        password: providerProxy.customConfig.password,
                    },
                };
            }
        }
        // 2. 继承系统全局代理
        if (this.globalProxy.enabled) {
            const proto = this.globalProxy.protocol || 'HTTP';
            const host = this.globalProxy.host || '127.0.0.1';
            const port = this.globalProxy.port || 7890;
            const proxyUrl = `${proto.toLowerCase()}://${host}:${port}`;
            return {
                useProxy: true,
                proxyUrl,
                protocol: proto,
                host,
                port,
                auth: {
                    username: this.globalProxy.username,
                    password: this.globalProxy.password,
                },
            };
        }
        return { useProxy: false };
    }
    /**
     * 针对流式路由构建带代理的 RequestInit 配置；dispatcher 为共享单例，
     * 防止每次 LLM 调用都泄漏一个 undici 连接池（长运行 OOM 根因，TC-00-99-003）。
     */
    async fetchWithProxy(targetUrl, init = {}, providerProxy) {
        const route = this.resolveRoute(targetUrl, providerProxy);
        const options = { ...init };
        if (route.useProxy && route.proxyUrl) {
            const shared = await this.getSharedDispatcher(route);
            if (shared) {
                options.dispatcher = shared;
            }
        }
        return fetch(targetUrl, options);
    }
    /**
     * 取同一路由的共享 ProxyAgent 单例；相同 (proxyUrl + 凭据) 复用同一连接池。
     */
    async getSharedDispatcher(route) {
        if (!route.useProxy || !route.proxyUrl)
            return null;
        try {
            const { ProxyAgent } = await import('undici');
            const token = route.auth?.username && route.auth?.password
                ? `Basic ${Buffer.from(`${route.auth.username}:${route.auth.password}`).toString('base64')}`
                : undefined;
            const key = `${route.proxyUrl}::${token ?? ''}`;
            const existing = this.dispatcherCache.get(key);
            if (existing)
                return existing;
            const agent = new ProxyAgent({ uri: route.proxyUrl, token });
            this.dispatcherCache.set(key, agent);
            return agent;
        }
        catch (err) {
            console.warn(`[Harness] ProxyAgent 加载失败，本次请求将绕过代理直连: ${err.message}`);
            return null;
        }
    }
    /** 销毁指定共享 dispatcher 并移除缓存（配置变更时调用）。 */
    async destroyDispatcher(dispatcher) {
        for (const [key, agent] of this.dispatcherCache) {
            if (agent === dispatcher) {
                this.dispatcherCache.delete(key);
                await agent.close?.().catch(() => undefined);
                return;
            }
        }
    }
    /** 服务停止时销毁全部共享 dispatcher，释放所有代理连接池。 */
    async destroyAll() {
        for (const [, agent] of this.dispatcherCache) {
            await agent.close?.().catch(() => undefined);
        }
        this.dispatcherCache.clear();
    }
    async *wrapStreamWithTimeout(stream) {
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
            let timer;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new SilentZombieTimeoutError(this.silentTimeoutMs));
                }, this.silentTimeoutMs);
            });
            try {
                const nextPromise = iterator.next();
                const result = await Promise.race([nextPromise, timeoutPromise]);
                if (timer)
                    clearTimeout(timer);
                if (result.done) {
                    break;
                }
                yield result.value;
            }
            catch (err) {
                if (timer)
                    clearTimeout(timer);
                throw err;
            }
        }
    }
}
