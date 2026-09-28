## [a1b2c3d4e5f6] Purple Grapes Harness 架构与开发纪律规范

- scope: project
- source: AGENTS.md
- created: 2026-09-28T00:00:00.000Z

Purple Grapes Harness (PGH) 核心纪律：
1. 零 Native 编译：禁用 node-gyp 与 MSVC，仅使用 node:sqlite 与标准库；
2. 权限规则与硬性红线：严禁 git push、敏感凭据读取（.env、密钥），未知工具一律 fail-closed；
3. TDD 铁律：先红灯测试再写实现，100% 验收唯测试论。
