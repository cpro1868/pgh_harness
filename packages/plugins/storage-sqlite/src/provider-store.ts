import type { SqliteDatabase } from './database.ts';

export interface ProviderRecord {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeyCipher: string;
  proxy: {
    enabled: boolean;
    mode: 'direct' | 'inherit' | 'custom';
    customConfig?: {
      protocol: string;
      host: string;
      port: number;
      username?: string;
      password?: string;
    };
  };
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    supportsTools?: boolean;
    supportsReasoning?: boolean;
  }>;
  createdAt: number;
  updatedAt: number;
}

type ProviderRow = {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  api_key_cipher: string;
  proxy_json: string;
  models_json: string;
  created_at: number;
  updated_at: number;
};

export class ProviderStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }


  public list(): ProviderRecord[] {
    const stmt = this.db.raw.prepare('SELECT * FROM providers ORDER BY created_at ASC;');
    const rows = stmt.all() as ProviderRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.base_url,
      apiKeyCipher: r.api_key_cipher,
      proxy: JSON.parse(r.proxy_json || '{}'),
      models: JSON.parse(r.models_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public get(id: string): ProviderRecord | undefined {
    const stmt = this.db.raw.prepare('SELECT * FROM providers WHERE id = ?;');
    const r = stmt.get(id) as ProviderRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      baseUrl: r.base_url,
      apiKeyCipher: r.api_key_cipher,
      proxy: JSON.parse(r.proxy_json || '{}'),
      models: JSON.parse(r.models_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public upsert(provider: Omit<ProviderRecord, 'createdAt' | 'updatedAt'>): ProviderRecord {
    const now = Date.now();
    const existing = this.get(provider.id);
    const createdAt = existing ? existing.createdAt : now;
    const proxyJson = JSON.stringify(provider.proxy || {});
    const modelsJson = JSON.stringify(provider.models || []);

    const stmt = this.db.raw.prepare(`
      INSERT INTO providers (id, name, protocol, base_url, api_key_cipher, proxy_json, models_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        protocol = excluded.protocol,
        base_url = excluded.base_url,
        api_key_cipher = excluded.api_key_cipher,
        proxy_json = excluded.proxy_json,
        models_json = excluded.models_json,
        updated_at = excluded.updated_at;
    `);

    stmt.run(
      provider.id,
      provider.name,
      provider.protocol,
      provider.baseUrl,
      provider.apiKeyCipher,
      proxyJson,
      modelsJson,
      createdAt,
      now
    );

    return {
      ...provider,
      createdAt,
      updatedAt: now,
    };
  }

  public updateProxyToggle(id: string, enabled: boolean): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    existing.proxy.enabled = enabled;
    this.upsert(existing);
    return true;
  }

  public delete(id: string): boolean {
    const stmt = this.db.raw.prepare('DELETE FROM providers WHERE id = ?;');
    stmt.run(id);
    return true;
  }
}
