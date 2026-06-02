import {
    type LanguageModel as AISDKLanguageModel,
    type LanguageModelMiddleware,
    defaultSettingsMiddleware,
    wrapLanguageModel,
} from "ai";
import type { CostCollector } from "./cost-collector";
import type { CostFunction } from "./costs";
import type { ModelEntry } from "./model-entries";
import { type MonitoringCallbacks, createLoggingMiddleware, mergeMonitoringCallbacks } from "./monitoring";
import { type ModelOptions, type ModelSettings, buildSettings } from "./options";

export type LanguageModel = Extract<AISDKLanguageModel, { specificationVersion: "v3" }>;

interface ModelRegistryConfig<TModel extends string> {
    models: Record<TModel, ModelEntry>;
    defaultSettings?: Omit<ModelSettings, "providerOptions">;
    monitoring?: MonitoringCallbacks;
}

/**
 * The model registry holds all the {@link LanguageModel} instances, wrapping them with
 * monitoring capabilities. It is a stateless, construct-once singleton: per-run cost
 * attribution flows through a {@link CostCollector} passed to {@link getModel}.
 */
export class ModelRegistry<TModel extends string> {
    private readonly models: Record<TModel, LanguageModel>;
    private readonly pricing: Record<string, CostFunction>;
    private readonly defaultSettings?: Omit<ModelSettings, "providerOptions">;
    private readonly monitoring?: MonitoringCallbacks;

    constructor({ models, defaultSettings, monitoring }: ModelRegistryConfig<TModel>) {
        const createdModels = Object.fromEntries(
            Object.entries(models).map(([key, entry]) => [key, (entry as ModelEntry).createModel()]),
        ) as Record<TModel, LanguageModel>;

        this.models = createdModels;

        this.pricing = Object.fromEntries(
            Object.entries(models).map(([key, entry]) => [
                createdModels[key as TModel].modelId,
                (entry as ModelEntry).pricing,
            ]),
        );

        this.defaultSettings = defaultSettings;
        this.monitoring = monitoring;
    }

    /**
     * Acquire a wrapped {@link LanguageModel} for the given options.
     *
     * When a per-call {@link CostCollector} is supplied, its monitoring callbacks are merged with
     * (not replacing) any registry-level `monitoring` set at construction, and both are driven by a
     * single logging middleware. This lets a shared, construct-once registry attribute cost to a
     * per-run collector without rebuilding the registry.
     */
    public getModel(options: ModelOptions<TModel>, costCollector?: CostCollector): LanguageModel {
        const settings = buildSettings({ ...this.defaultSettings, ...options });
        const model = this.models[options.model];
        // biome-ignore lint/style/noNonNullAssertion: This is guaranteed by construction
        const pricing = this.pricing[model.modelId]!;

        const monitoringMiddleware = this.buildMonitoringMiddleware(options, pricing, costCollector);

        return wrapLanguageModel({
            model,
            middleware: [
                ...(monitoringMiddleware != null ? [monitoringMiddleware] : []),
                defaultSettingsMiddleware({ settings }),
            ],
        });
    }

    private buildMonitoringMiddleware(
        options: ModelOptions<TModel>,
        pricing: CostFunction,
        costCollector?: CostCollector,
    ): LanguageModelMiddleware | undefined {
        const callbacks: MonitoringCallbacks[] = [];

        if (this.monitoring != null) callbacks.push(this.monitoring);
        if (costCollector != null) callbacks.push(costCollector.createMonitoringCallbacks());

        if (callbacks.length === 0) return undefined;

        const merged = mergeMonitoringCallbacks(callbacks);
        return createLoggingMiddleware(options, merged, pricing);
    }
}
