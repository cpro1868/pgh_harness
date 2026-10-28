const DEFAULT_PROXY = { enabled: false, mode: 'inherit' };
const PROXY_MODES = new Set(['direct', 'inherit', 'custom']);
const PROXY_PROTOCOLS = new Set(['HTTP', 'HTTPS', 'SOCKS5']);
export function sanitizeProxyConfig(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return { ...DEFAULT_PROXY };
    const obj = raw;
    const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : false;
    const mode = typeof obj.mode === 'string' && PROXY_MODES.has(obj.mode)
        ? obj.mode
        : 'inherit';
    const sanitized = { enabled, mode };
    const cc = obj.customConfig;
    if (typeof cc === 'object' && cc !== null && !Array.isArray(cc)) {
        const c = cc;
        const protocol = typeof c.protocol === 'string' && PROXY_PROTOCOLS.has(c.protocol)
            ? c.protocol
            : undefined;
        const host = typeof c.host === 'string' && c.host.length > 0 && c.host.length <= 255 ? c.host : undefined;
        const port = typeof c.port === 'number' && Number.isInteger(c.port) && c.port >= 1 && c.port <= 65535 ? c.port : undefined;
        if (protocol && host && port) {
            const built = { protocol, host, port };
            if (typeof c.username === 'string' && c.username.length <= 255)
                built.username = c.username;
            if (typeof c.password === 'string' && c.password.length <= 512)
                built.password = c.password;
            sanitized.customConfig = built;
        }
    }
    return sanitized;
}
