export class ProviderStore {
    db;
    constructor(db) {
        this.db = db;
    }
    list() {
        const stmt = this.db.raw.prepare('SELECT * FROM providers ORDER BY created_at ASC;');
        const rows = stmt.all();
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
    get(id) {
        const stmt = this.db.raw.prepare('SELECT * FROM providers WHERE id = ?;');
        const r = stmt.get(id);
        if (!r)
            return undefined;
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
    upsert(provider) {
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
        stmt.run(provider.id, provider.name, provider.protocol, provider.baseUrl, provider.apiKeyCipher, proxyJson, modelsJson, createdAt, now);
        return {
            ...provider,
            createdAt,
            updatedAt: now,
        };
    }
    updateProxyToggle(id, enabled) {
        const existing = this.get(id);
        if (!existing)
            return false;
        existing.proxy.enabled = enabled;
        this.upsert(existing);
        return true;
    }
    delete(id) {
        const stmt = this.db.raw.prepare('DELETE FROM providers WHERE id = ?;');
        stmt.run(id);
        return true;
    }
}
