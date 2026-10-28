import type { SqliteDatabase } from './database.ts';
import type { SessionModel } from '@harness/protocol';
export declare class SessionStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    create(session: Omit<SessionModel, 'createdAt' | 'updatedAt'>): SessionModel;
    get(id: string): SessionModel | undefined;
    list(): SessionModel[];
    touch(id: string): void;
    /**
     * 重命名会话标题。
     * @param id - 会话标识。
     * @param title - 新标题。
     * @returns 是否命中了会话。
     */
    setTitle(id: string, title: string): boolean;
    /**
     * 更新会话的权限预设（只读 / 编辑 / 完全授权）。
     * @param id - 会话标识。
     * @param preset - 目标预设，由调用方完成取值校验。
     * @returns 是否命中了会话。
     */
    setPreset(id: string, preset: SessionModel['preset']): boolean;
    delete(id: string): boolean;
}
