export class PluginDependencyMissingError extends Error {
  public readonly pluginName: string;
  public readonly missingService: string;

  constructor(pluginName: string, missingService: string) {
    super(`[Kernel Fail-Fast] Plugin "${pluginName}" missing required dependency "${missingService}"`);
    this.name = 'PluginDependencyMissingError';
    this.pluginName = pluginName;
    this.missingService = missingService;
  }
}


export interface PluginDefinition {
  name: string;
  inject?: string[];
  provides?: string[];
  apply: (ctx: Context) => void | Promise<void>;
}

export class Context {
  private services = new Map<string, unknown>();
  private plugins: PluginDefinition[] = [];
  private started = false;

  public plugin(def: PluginDefinition): this {
    this.plugins.push(def);
    return this;
  }

  public provide<T = unknown>(name: string, service: T): void {
    this.services.set(name, service);
  }

  public getService<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  public async start(): Promise<void> {
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
    } catch (err) {
      // Fail-Fast: 原子回滚已有服务注册
      this.services = backupServices;
      this.started = false;
      throw err;
    }
  }

  public isStarted(): boolean {
    return this.started;
  }
}
