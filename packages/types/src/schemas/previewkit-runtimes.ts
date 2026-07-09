/**
 * The raw-runtime catalog: the single source of truth for PreviewKit's "raw
 * runtime" build escape hatch. A user picks one of these instead of letting
 * autodetection guess, then writes a bash build script + entrypoint; the
 * previewkit Dockerfile generator turns the selection into a `FROM <image>`, a
 * tiered toolbelt install, and a little per-runtime setup. The dashboard reads
 * the same catalog to render the runtime tiles, the version selector, the live
 * "service spec" rail, and the "installed by default" chips.
 *
 * Two flavors, both in this one list:
 * - **language runtimes** (`raw: false`) - Node, Python, ... on a Debian base.
 * - **base image** (`raw: true`) - bare Debian, "you install what you need".
 *
 * Every runtime is Debian-family (apt): Debian's slim images cover every case we
 * need, and a single base keeps the toolbelt, the shell, and the generated
 * Dockerfile uniform (bash is native, no apk/musl edge cases). The tool lists
 * here are HONEST: they were verified against the actual public images (which are
 * far barer than they look - `node:*-slim` has no git/curl, `python:*-slim` has
 * only python+pip) and reflect only what the base image ships plus what our
 * toolbelt + {@link PreviewkitRuntimeSpec.setup} actually install. The version is
 * user-selectable (`imageTemplate` + `defaultVersion` + suggested `versions`) so
 * a repo pinned to an older toolchain is never forced onto our default.
 */

export const PREVIEWKIT_RUNTIME_IDS = ["node", "python", "go", "rust", "java", "ruby", "php", "cpp", "debian"] as const;

export type PreviewkitRuntime = (typeof PREVIEWKIT_RUNTIME_IDS)[number];

/**
 * The base image's package manager, which selects the toolbelt-install strategy.
 * Every runtime is Debian-family today, so this is `apt`-only; it stays a named
 * type (rather than being inlined) so adding a future base OS is one entry in the
 * catalog and one strategy in the generator, not a scattered branch.
 */
export type PreviewkitRuntimeBase = "apt";

/**
 * The common toolbelt the generator installs on top of every runtime, keyed by
 * the base image's package manager. `packages` are the exact package names the
 * generator installs; `display` are the friendly names the UI shows in the
 * "installed in every runtime" tail.
 */
export const PREVIEWKIT_TOOLBELT: Record<
    PreviewkitRuntimeBase,
    { packages: readonly string[]; display: readonly string[] }
> = {
    apt: {
        packages: [
            "git",
            "curl",
            "wget",
            "jq",
            "ripgrep",
            "make",
            "openssh-client",
            "tmux",
            "sqlite3",
            "tar",
            "zip",
            "unzip",
            "ca-certificates",
        ],
        display: ["git", "curl", "wget", "jq", "rg", "make", "ssh", "tmux", "sqlite3", "tar", "zip", "unzip"],
    },
};

export interface PreviewkitRuntimeSpec {
    id: PreviewkitRuntime;
    /** Display name, e.g. "Node.js". */
    label: string;
    /** Two/three-letter tile abbreviation, e.g. "JS". */
    abbr: string;
    /** Docker Hub image ref with a `{version}` placeholder, e.g. `node:{version}-bookworm-slim`. */
    imageTemplate: string;
    /** The version the tile ships with - a tag we have verified pulls. */
    defaultVersion: string;
    /** Suggested versions for the selector (newest first). The user may also type a custom tag. */
    versions: readonly string[];
    /** Docker Hub page for the base image; the spec rail links here. */
    dockerHubUrl: string;
    /** Package manager the base image ships - selects the toolbelt tier the generator installs. */
    base: PreviewkitRuntimeBase;
    /** A bare base image (Debian/Alpine) rather than a batteries-included language runtime. */
    raw: boolean;
    /**
     * Runtime-specific tools guaranteed available - the base image plus anything
     * in {@link setup}. Does NOT repeat the shared {@link PREVIEWKIT_TOOLBELT}
     * (the UI shows that separately as the "installed in every runtime" tail).
     * Verified against the real images - no aspirational chips.
     */
    tools: readonly string[];
    /**
     * Extra image-setup commands run as cached RUN layers (after the toolbelt,
     * before `COPY`) to make the advertised tools real on top of the slim public
     * base image - e.g. enable corepack, install uv / composer / cmake. Absent
     * from the base image but cheap and sensible; not the full long tail.
     */
    setup: readonly string[];
    /** Prefilled build script the tile selection drops into the editor. */
    defaultBuildScript: string;
    /** Prefilled entrypoint the tile selection drops into the editor. */
    defaultEntrypoint: string;
}

export const PREVIEWKIT_RUNTIME_CATALOG: Record<PreviewkitRuntime, PreviewkitRuntimeSpec> = {
    node: {
        id: "node",
        label: "Node.js",
        abbr: "JS",
        imageTemplate: "node:{version}-bookworm-slim",
        defaultVersion: "22",
        versions: ["22", "20", "18"],
        dockerHubUrl: "https://hub.docker.com/_/node",
        base: "apt",
        raw: false,
        // corepack (in the base image, enabled by setup) provides pnpm + yarn.
        tools: ["node", "npm", "pnpm", "yarn"],
        setup: ["corepack enable"],
        defaultBuildScript: "npm install\nnpm run build",
        defaultEntrypoint: "npm start",
    },
    python: {
        id: "python",
        label: "Python",
        abbr: "PY",
        imageTemplate: "python:{version}-slim-bookworm",
        defaultVersion: "3.12",
        versions: ["3.13", "3.12", "3.11"],
        dockerHubUrl: "https://hub.docker.com/_/python",
        base: "apt",
        raw: false,
        // uv is a single fast binary we install; poetry/pytest come via it if needed.
        tools: ["python", "pip", "uv"],
        setup: ["pip install --no-cache-dir uv"],
        defaultBuildScript: "uv sync",
        defaultEntrypoint: "python main.py",
    },
    go: {
        id: "go",
        label: "Go",
        abbr: "GO",
        imageTemplate: "golang:{version}-bookworm",
        defaultVersion: "1.22",
        versions: ["1.23", "1.22", "1.21"],
        dockerHubUrl: "https://hub.docker.com/_/golang",
        base: "apt",
        raw: false,
        tools: ["go", "gofmt"],
        setup: [],
        defaultBuildScript: "go mod download\ngo build -o app ./...",
        defaultEntrypoint: "./app",
    },
    rust: {
        id: "rust",
        label: "Rust",
        abbr: "RS",
        imageTemplate: "rust:{version}-slim-bookworm",
        defaultVersion: "1.77",
        versions: ["1.82", "1.79", "1.77"],
        dockerHubUrl: "https://hub.docker.com/_/rust",
        base: "apt",
        raw: false,
        // cargo/rustc/rustfmt ship; clippy is added via rustup by setup.
        tools: ["cargo", "rustc", "rustfmt", "clippy"],
        setup: ["rustup component add clippy"],
        defaultBuildScript: "cargo build --release",
        defaultEntrypoint: "./target/release/app",
    },
    java: {
        id: "java",
        label: "Java",
        abbr: "JV",
        imageTemplate: "eclipse-temurin:{version}-jdk",
        defaultVersion: "21",
        versions: ["23", "21", "17"],
        dockerHubUrl: "https://hub.docker.com/_/eclipse-temurin",
        base: "apt",
        raw: false,
        // The image is JDK-only; use the gradle/maven wrapper (./gradlew, ./mvnw).
        tools: ["java", "javac"],
        setup: [],
        defaultBuildScript: "./gradlew build",
        defaultEntrypoint: "java -jar build/libs/app.jar",
    },
    ruby: {
        id: "ruby",
        label: "Ruby",
        abbr: "RB",
        imageTemplate: "ruby:{version}-slim-bookworm",
        defaultVersion: "3.3",
        versions: ["3.4", "3.3", "3.2"],
        dockerHubUrl: "https://hub.docker.com/_/ruby",
        base: "apt",
        raw: false,
        tools: ["ruby", "gem", "bundler", "rake"],
        setup: [],
        defaultBuildScript: "bundle install",
        defaultEntrypoint: "bundle exec ruby app.rb",
    },
    php: {
        id: "php",
        label: "PHP",
        abbr: "PHP",
        imageTemplate: "php:{version}-cli-bookworm",
        defaultVersion: "8.3",
        versions: ["8.4", "8.3", "8.2"],
        dockerHubUrl: "https://hub.docker.com/_/php",
        base: "apt",
        raw: false,
        // composer is not in php:*-cli; setup installs it globally.
        tools: ["php", "composer"],
        setup: ["curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer"],
        defaultBuildScript: "composer install",
        defaultEntrypoint: "php -S 0.0.0.0:8080",
    },
    cpp: {
        id: "cpp",
        label: "C / C++",
        abbr: "C++",
        imageTemplate: "gcc:{version}-bookworm",
        defaultVersion: "13",
        versions: ["14", "13", "12"],
        dockerHubUrl: "https://hub.docker.com/_/gcc",
        base: "apt",
        raw: false,
        // gcc/g++/make ship; cmake is not in the gcc image, so setup installs it.
        tools: ["gcc", "g++", "make", "cmake"],
        setup: ["apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*"],
        defaultBuildScript: "cmake -B build\ncmake --build build",
        defaultEntrypoint: "./build/app",
    },
    debian: {
        id: "debian",
        label: "Debian",
        abbr: "DEB",
        imageTemplate: "debian:{version}-slim",
        defaultVersion: "bookworm",
        versions: ["trixie", "bookworm", "bullseye"],
        dockerHubUrl: "https://hub.docker.com/_/debian",
        base: "apt",
        raw: true,
        tools: ["apt", "dpkg", "bash"],
        setup: [],
        defaultBuildScript: "apt-get update\napt-get install -y build-essential",
        defaultEntrypoint: "./start.sh",
    },
};

export const PREVIEWKIT_RUNTIMES: readonly PreviewkitRuntimeSpec[] = PREVIEWKIT_RUNTIME_IDS.map(
    (id) => PREVIEWKIT_RUNTIME_CATALOG[id],
);

export function previewkitRuntimeSpec(runtime: PreviewkitRuntime): PreviewkitRuntimeSpec {
    return PREVIEWKIT_RUNTIME_CATALOG[runtime];
}

/** Resolves the concrete Docker Hub image ref for a runtime + optional version (falling back to the default). */
export function previewkitRuntimeImage(runtime: PreviewkitRuntime, version?: string): string {
    const spec = PREVIEWKIT_RUNTIME_CATALOG[runtime];
    return spec.imageTemplate.replace("{version}", version ?? spec.defaultVersion);
}
