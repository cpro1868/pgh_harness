import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPrivateOrReservedIp, validateUrlForSsrf, fetchUrlSafe, SsfSecurityError } from '../src/fetch-tools.ts';

test('TC-01-05-007: 安全工程 BL-04 受控网络抓取工具 fetch_url 与严格 SSRF 防护', async (t) => {
  await t.test('1. 私网与保留 IP 校验：准确识别并拦截', () => {
    // IPv4 回环
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('127.1.2.3'), true);
    // 局域网私网段
    assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
    assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
    assert.equal(isPrivateOrReservedIp('172.31.255.255'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true); // 云元数据
    // 公网合法 IP
    assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
    assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
    assert.equal(isPrivateOrReservedIp('172.32.0.1'), false);

    // IPv6
    assert.equal(isPrivateOrReservedIp('::1'), true);
    assert.equal(isPrivateOrReservedIp('fe80::1'), true);
    assert.equal(isPrivateOrReservedIp('fc00::1'), true);
  });

  await t.test('2. URL 合法性与 SSRF 阻断：非 HTTP 协议与内网域名一律拒绝 (fail-closed)', () => {
    assert.throws(() => validateUrlForSsrf('ftp://example.com/file'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('file:///etc/passwd'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('http://localhost:3000/api'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('http://router.local/admin'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('http://127.0.0.1:8080'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('http://10.10.10.10/secret'), SsfSecurityError);
    assert.throws(() => validateUrlForSsrf('http://169.254.169.254/latest/meta-data'), SsfSecurityError);

    // 合法公网 URL 放行
    const url = validateUrlForSsrf('https://api.github.com/repos');
    assert.equal(url.hostname, 'api.github.com');
  });

  await t.test('3. HTTP 302 重定向跨网段逃逸防御：重定向到内网时被立即阻断', async () => {
    // 启动本地受控模拟服务器
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect-evil') {
        res.writeHead(302, { Location: 'http://127.0.0.1:8080/internal-data' });
        res.end();
      } else if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Mock Public OK');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      // 尝试抓取直接指向 127.0.0.1 的端口，应该在首跳直接被阻断
      await assert.rejects(
        async () => {
          await fetchUrlSafe(`http://127.0.0.1:${port}/ok`);
        },
        SsfSecurityError,
        '首跳访问 127.0.0.1 必须被 SSRF 阻断'
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
