export declare class MasterKeyError extends Error {
    constructor(message: string);
}
/** 允许通过环境变量注入主密钥（便于容器化部署与 CI）。 */
export declare const MASTER_KEY_ENV = "PGH_MASTER_KEY";
/**
 * 解析应用主密钥（安全工程方法论 §4.1 / BL-07）。
 *
 * 优先级：环境变量 `PGH_MASTER_KEY` → 数据目录下已存在的 `master.key` → 随机生成并落盘。
 * **任何情况下都不得硬编码**：固定主密钥会让 AES-256-GCM 的强度归零 ——
 * 任何拿到数据库文件的人都能解出其中的 API Key。
 *
 * @param dataDir - 数据目录（`~/.pg_harness`）。
 * @returns 64 位十六进制的主密钥。
 * @throws MasterKeyError 当环境变量或密钥文件格式非法时（拒绝启动，不静默降级）。
 */
export declare function resolveMasterKey(dataDir: string): string;
