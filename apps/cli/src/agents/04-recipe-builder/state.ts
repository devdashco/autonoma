import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type EntityStatus = "pending" | "recipe-accepted" | "tested-up" | "tested-down" | "skipped";

export interface EntityProgress {
    entityName: string;
    status: EntityStatus;
    recipeData?: Record<string, unknown>[];
    errorLog: string[];
}

export type SdkAdapter =
    | {
          language: "typescript";
          framework: "express";
          sdkPackage: "@autonoma-ai/sdk";
          adapterPackage: "@autonoma-ai/server-express";
      }
    | {
          language: "typescript";
          framework: "node";
          sdkPackage: "@autonoma-ai/sdk";
          adapterPackage: "@autonoma-ai/server-node";
      }
    | {
          language: "typescript";
          framework: "hono";
          sdkPackage: "@autonoma-ai/sdk";
          adapterPackage: "@autonoma-ai/server-hono";
      }
    | {
          language: "typescript";
          framework: "web";
          sdkPackage: "@autonoma-ai/sdk";
          adapterPackage: "@autonoma-ai/server-web";
      }
    | { language: "python"; framework: "flask"; sdkPackage: "autonoma-ai"; adapterPackage: "autonoma_flask" }
    | { language: "python"; framework: "fastapi"; sdkPackage: "autonoma-ai"; adapterPackage: "autonoma_fastapi" }
    | { language: "python"; framework: "django"; sdkPackage: "autonoma-ai"; adapterPackage: "autonoma_django" }
    | {
          language: "go";
          framework: "gin";
          sdkPackage: "github.com/autonoma-ai/sdk-go";
          adapterPackage: "github.com/autonoma-ai/sdk-go";
      }
    | { language: "ruby"; framework: "rails"; sdkPackage: "autonoma-ai"; adapterPackage: "autonoma-ai" }
    | { language: "ruby"; framework: "rack"; sdkPackage: "autonoma-ai"; adapterPackage: "autonoma-ai" }
    | { language: "java"; framework: "spring"; sdkPackage: "autonoma-sdk"; adapterPackage: "autonoma-spring" }
    | { language: "php"; framework: "laravel"; sdkPackage: "autonoma-ai/sdk"; adapterPackage: "autonoma-ai/sdk" }
    | { language: "rust"; framework: "axum"; sdkPackage: "autonoma-sdk"; adapterPackage: "autonoma-sdk" }
    | { language: "rust"; framework: "actix"; sdkPackage: "autonoma-sdk"; adapterPackage: "autonoma-sdk" }
    | { language: "elixir"; framework: "plug"; sdkPackage: "autonoma"; adapterPackage: "autonoma" };

export type TechStack = SdkAdapter;

export const ALL_ADAPTERS: SdkAdapter[] = [
    {
        language: "typescript",
        framework: "web",
        sdkPackage: "@autonoma-ai/sdk",
        adapterPackage: "@autonoma-ai/server-web",
    },
    {
        language: "typescript",
        framework: "express",
        sdkPackage: "@autonoma-ai/sdk",
        adapterPackage: "@autonoma-ai/server-express",
    },
    {
        language: "typescript",
        framework: "node",
        sdkPackage: "@autonoma-ai/sdk",
        adapterPackage: "@autonoma-ai/server-node",
    },
    {
        language: "typescript",
        framework: "hono",
        sdkPackage: "@autonoma-ai/sdk",
        adapterPackage: "@autonoma-ai/server-hono",
    },
    { language: "python", framework: "flask", sdkPackage: "autonoma-ai", adapterPackage: "autonoma_flask" },
    { language: "python", framework: "fastapi", sdkPackage: "autonoma-ai", adapterPackage: "autonoma_fastapi" },
    { language: "python", framework: "django", sdkPackage: "autonoma-ai", adapterPackage: "autonoma_django" },
    {
        language: "go",
        framework: "gin",
        sdkPackage: "github.com/autonoma-ai/sdk-go",
        adapterPackage: "github.com/autonoma-ai/sdk-go",
    },
    { language: "ruby", framework: "rails", sdkPackage: "autonoma-ai", adapterPackage: "autonoma-ai" },
    { language: "ruby", framework: "rack", sdkPackage: "autonoma-ai", adapterPackage: "autonoma-ai" },
    { language: "java", framework: "spring", sdkPackage: "autonoma-sdk", adapterPackage: "autonoma-spring" },
    { language: "php", framework: "laravel", sdkPackage: "autonoma-ai/sdk", adapterPackage: "autonoma-ai/sdk" },
    { language: "rust", framework: "axum", sdkPackage: "autonoma-sdk", adapterPackage: "autonoma-sdk" },
    { language: "rust", framework: "actix", sdkPackage: "autonoma-sdk", adapterPackage: "autonoma-sdk" },
    { language: "elixir", framework: "plug", sdkPackage: "autonoma", adapterPackage: "autonoma" },
];

export function adapterKey(a: SdkAdapter): string {
    return `${a.language}:${a.framework}`;
}

export function adapterLabel(a: SdkAdapter): string {
    const lang = a.language.charAt(0).toUpperCase() + a.language.slice(1);
    const fw = a.framework.charAt(0).toUpperCase() + a.framework.slice(1);
    return `${lang} + ${fw}`;
}

export function findAdapter(language: string, framework: string): SdkAdapter | undefined {
    return ALL_ADAPTERS.find((a) => a.language === language.toLowerCase() && a.framework === framework.toLowerCase());
}

export const ADAPTER_HINTS: Record<string, string> = {
    "typescript:express": "Express.js and Express-compatible frameworks",
    "typescript:node": "Plain Node.js HTTP server (built-in http module)",
    "typescript:hono": "Hono framework (works with Bun, Deno, Node)",
    "typescript:web": "Web Standard Request/Response - covers Next.js, Remix, Nuxt, Bun, Deno, SvelteKit, Astro",
    "python:flask": "Flask framework",
    "python:fastapi": "FastAPI framework",
    "python:django": "Django framework",
    "go:gin": "Gin framework for Go",
    "ruby:rails": "Ruby on Rails",
    "ruby:rack": "Rack-based Ruby frameworks (Sinatra, Hanami, etc.)",
    "java:spring": "Spring Boot / Spring Framework",
    "php:laravel": "Laravel framework",
    "rust:axum": "Axum framework for Rust",
    "rust:actix": "Actix Web framework for Rust",
    "elixir:plug": "Plug / Phoenix framework for Elixir",
};

export interface RecipeBuilderState {
    phase: "tech-detect" | "entity-loop" | "full-validation" | "submit" | "done";
    techStack?: TechStack;
    entityOrder: string[];
    entities: Record<string, EntityProgress>;
    currentEntityIndex: number;
    sdkEndpointUrl?: string;
    sharedSecret?: string;
}

const STATE_FILE = ".recipe-builder-state.json";

export function initialRecipeState(): RecipeBuilderState {
    return {
        phase: "tech-detect",
        entityOrder: [],
        entities: {},
        currentEntityIndex: 0,
    };
}

export async function loadRecipeState(outputDir: string): Promise<RecipeBuilderState | undefined> {
    try {
        const raw = await readFile(join(outputDir, STATE_FILE), "utf-8");
        const parsed: RecipeBuilderState = JSON.parse(raw);
        return parsed;
    } catch {
        return undefined;
    }
}

export async function saveRecipeState(outputDir: string, state: RecipeBuilderState): Promise<void> {
    await writeFile(join(outputDir, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
}
