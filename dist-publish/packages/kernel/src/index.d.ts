export declare class PluginDependencyMissingError extends Error {
    readonly pluginName: string;
    readonly missingService: string;
    constructor(pluginName: string, missingService: string);
}
export interface PluginDefinition {
    name: string;
    inject?: string[];
    provides?: string[];
    apply: (ctx: Context) => void | Promise<void>;
}
export declare class Context {
    private services;
    private plugins;
    private started;
    plugin(def: PluginDefinition): this;
    provide<T = unknown>(name: string, service: T): void;
    getService<T = unknown>(name: string): T | undefined;
    start(): Promise<void>;
    isStarted(): boolean;
}
