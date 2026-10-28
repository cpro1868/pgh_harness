export class PluginDependencyMissingError extends Error {
    pluginName;
    missingService;
    constructor(pluginName, missingService) {
        super(`[Kernel Fail-Fast] Plugin "${pluginName}" missing required dependency "${missingService}"`);
        this.name = 'PluginDependencyMissingError';
        this.pluginName = pluginName;
        this.missingService = missingService;
    }
}
export class Context {
    services = new Map();
    plugins = [];
    started = false;
    plugin(def) {
        this.plugins.push(def);
        return this;
    }
    provide(name, service) {
        this.services.set(name, service);
    }
    getService(name) {
        return this.services.get(name);
    }
    async start() {
        const backupServices = new Map(this.services);
        try {
            for (const p of this.plugins) {
                if (p.inject && p.inject.length > 0) {
                    for (const dep of p.inject) {
                        if (!this.services.has(dep)) {
                            throw new PluginDependencyMissingError(p.name, dep);
                        }
                    }
                }
                await p.apply(this);
            }
            this.started = true;
        }
        catch (err) {
            // Fail-Fast: 原子回滚已有服务注册
            this.services = backupServices;
            this.started = false;
            throw err;
        }
    }
    isStarted() {
        return this.started;
    }
}
