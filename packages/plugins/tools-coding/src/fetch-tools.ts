import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class SsfSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsfSecurityError';
  }
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
export function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4 检查
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const p0 = parts[0] as number;
    const p1 = parts[1] as number;
    // 0.0.0.0/8
    if (p0 === 0) return true;
    // 10.0.0.0/8 (私网)
    if (p0 === 10) return true;
    // 127.0.0.0/8 (回环)
    if (p0 === 127) return true;
    // 169.254.0.0/16 (链路本地 / 云厂商元数据 169.254.169.254)
    if (p0 === 169 && p1 === 254) return true;
    // 172.16.0.0/12 (私网: 172.16.0.0 - 172.31.255.255)
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    // 192.168.0.0/16 (私网)
    if (p0 === 192 && p1 === 168) return true;
    // 100.64.0.0/10 (运营商级 NAT)
    if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;
    // 224.0.0.0/4 (多播) 与 240.0.0.0/4 (保留)
    if (p0 >= 224) return true;
    return false;
  }

  // IPv6 检查
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    // 回环 ::1
    if (norm === '::1' || norm === '0:0:0:0:0:0:0:1') return true;
    // 未指定 ::
    if (norm === '::' || norm === '0:0:0:0:0:0:0:0') return true;
    // 唯一本地 fe80::/10 (链路本地)
    if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true;
    // 私有地址 fc00::/7 (fc00:: ~ fdff::)
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;
    // IPv4 映射的 IPv6 (::ffff:x.x.x.x)
    if (norm.startsWith('::ffff:')) {
      const v4Part = norm.slice(7);
      if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }
    return false;
  }

  return true; // 未知/非标准格式，fail-closed 默认按非法拦截
}

/**
 * 校验目标主机与协议（拦截内网与常见协议穿越）
 */
export function validateUrlForSsrf(targetUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SsfSecurityError(`非法 URL 格式: ${targetUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsfSecurityError(`仅允许 HTTP/HTTPS 协议网络访问，拒绝: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  // 拦截常见回环域名
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new SsfSecurityError(`安全拦截：禁止访问内网或保留主机名: ${hostname}`);
  }

  // 若 hostname 直接是数字或标准 IP，立即检测
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsfSecurityError(`安全拦截：目标 IP ${hostname} 属于私有或回环受保护网段，拒绝访问`);
    }
  }

  return parsed;
}

/**
 * 受控网络抓取工具 (Safe fetch_url with strict SSRF defense)
 */
export async function fetchUrlSafe(targetUrl: string, options: FetchUrlOptions = {}): Promise<FetchUrlResult> {
  const maxBytes = options.maxBytes ?? 1024 * 1024; // 默认 1MB 截断
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxRedirects = options.maxRedirects ?? 3;

  let currentUrl = targetUrl;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const parsed = validateUrlForSsrf(currentUrl);

    const client = parsed.protocol === 'https:' ? https : http;

    const resResult = await new Promise<{
      statusCode: number;
      headers: Record<string, string>;
      body: string;
      redirectUrl?: string;
    }>((resolve, reject) => {
      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'PurpleGrapesHarness/0.2.0 (Agent-FetchSafe)',
            'Accept': 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
          },
          timeout: timeoutMs,
        },
        (res) => {
          const statusCode = res.statusCode || 200;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }

          // 301/302 重定向检测与目标 SSRF 检查
          if (statusCode >= 300 && statusCode < 400 && headers['location']) {
            res.resume(); // 丢弃当前流
            try {
              const nextLoc = new URL(headers['location'], currentUrl).toString();
              resolve({ statusCode, headers, body: '', redirectUrl: nextLoc });
            } catch {
              reject(new SsfSecurityError(`重定向目标非法: ${headers['location']}`));
            }
            return;
          }

          let receivedBytes = 0;
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxBytes) {
              res.destroy(new Error(`响应内容超过单次体积上限 (${maxBytes} bytes)`));
              return;
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({ statusCode, headers, body });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`网络抓取超时 (${timeoutMs}ms)`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });

    if (resResult.redirectUrl) {
      redirects++;
      currentUrl = resResult.redirectUrl;
      continue;
    }

    return {
      statusCode: resResult.statusCode,
      headers: resResult.headers,
      content: resResult.body,
      sizeBytes: Buffer.byteLength(resResult.body, 'utf8'),
      finalUrl: currentUrl,
    };
  }

  throw new SsfSecurityError(`超过最大重定向次数限制 (${maxRedirects})`);
}
