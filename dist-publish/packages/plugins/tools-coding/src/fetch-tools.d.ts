export declare class SsfSecurityError extends Error {
    constructor(message: string);
}
export interface FetchUrlOptions {
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
}
export interface FetchUrlResult {
    statusCode: number;
    headers: Record<string, string>;
    content: string;
    sizeBytes: number;
    finalUrl: string;
}
/**
 * 判断 IP 地址是否属于私有、回环或特殊保留网段 (安全工程方法论 BL-04 / S1 / S2)
 */
export declare function isPrivateOrReservedIp(ip: string): boolean;
/**
 * 校验目标主机与协议（拦截内网与常见协议穿越）
 */
export declare function validateUrlForSsrf(targetUrl: string): URL;
/**
 * 受控网络抓取工具 (Safe fetch_url with strict SSRF defense)
 */
export declare function fetchUrlSafe(targetUrl: string, options?: FetchUrlOptions): Promise<FetchUrlResult>;
