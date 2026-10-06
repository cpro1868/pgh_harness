import type { NetworkProxyConfig } from '@harness/protocol';

export class SilentZombieTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`[NetworkProxy] Silent zombie connection detected: No new chunks received within ${timeoutMs}ms. Stream suspended.`);
    this.name = 'SilentZombieTimeoutError';
    this.timeoutMs = timeoutMs;
  }
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
  auth?: { username?: string; password?: string };
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

export class ProxyDispatcher {
  private globalProxy: NetworkProxyConfig;
  private silentTimeoutMs: number;

  constructor(options: DispatcherOptions) {
    this.globalProxy = options.globalProxy;
    this.silentTimeoutMs = options.silentTimeoutMs ?? 45000;
  }

  public getGlobalProxy(): NetworkProxyConfig {
    return { ...this.globalProxy };
  }

  public updateGlobalProxy(config: NetworkProxyConfig): void {
    this.globalProxy = config;
  }

  public shouldBypass(targetUrl: string): boolean {
    if (!this.globalProxy.bypassList) return false;
    try {
      const url = new URL(targetUrl);
      const host = url.hostname.toLowerCase();
      const bypasses = this.globalProxy.bypassList
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      for (const item of bypasses) {
        if (item === host) return true;
        if (item.startsWith('*.')) {
          const suffix = item.slice(2);
          if (host.endsWith(suffix) || host === suffix) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  public resolveRoute(
    targetUrl: string,
    providerProxy?: ProviderProxyOption
  ): RouteResolution {
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
   * 针对 Node 22 原生 fetch 构建带代理的 RequestInit 配置
   */
  public async fetchWithProxy(
    targetUrl: string,
    init: RequestInit = {},
    providerProxy?: ProviderProxyOption,
  ): Promise<Response> {
    const route = this.resolveRoute(targetUrl, providerProxy);
    const options: RequestInit & { dispatcher?: unknown } = { ...init };

    if (route.useProxy && route.proxyUrl) {
      // 动态使用 Node 22 内置支持的 undici ProxyAgent
      try {
        const { ProxyAgent } = await import('undici');
        options.dispatcher = new ProxyAgent({
          uri: route.proxyUrl,
          token: route.auth?.username && route.auth?.password
            ? `Basic ${Buffer.from(`${route.auth.username}:${route.auth.password}`).toString('base64')}`
            : undefined,
        });
      } catch (err) {
        console.warn(`[Harness] ProxyAgent 加载失败，本次请求将绕过代理直连: ${(err as Error).message}`);
      }
    }

    return fetch(targetUrl, options);
  }

  public async *wrapStreamWithTimeout<T>(stream: AsyncIterable<T>): AsyncIterable<T> {
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SilentZombieTimeoutError(this.silentTimeoutMs));
        }, this.silentTimeoutMs);
      });

      try {
        const nextPromise = iterator.next();
        const result = await Promise.race([nextPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        if (result.done) {
          break;
        }
        yield result.value;
      } catch (err) {
        if (timer) clearTimeout(timer);
        throw err;
      }
    }
  }
}
