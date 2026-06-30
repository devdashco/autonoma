import { describe, expect, test, vi, beforeEach } from "vitest";
import {
    parseDiscoverBody,
    renderModelSchema,
    validateRecipeAgainstSchema,
    formatValidationProblems,
    fetchDiscoverSchema,
    type DiscoverSchema,
} from "../../src/agents/04-recipe-builder/discover-schema";
import type { AuditedModel } from "../../src/agents/04-recipe-builder/entity-order";
import * as sdk from "../../src/agents/04-recipe-builder/http-client";
import { buildSingleEntityRecipe } from "../../src/agents/04-recipe-builder/recipe";
import type { EntityProgress } from "../../src/agents/04-recipe-builder/state";

// fetchDiscoverSchema is best-effort: stub the HTTP layer so we can assert it
// degrades to null instead of throwing.
vi.mock("../../src/agents/04-recipe-builder/http-client", () => ({
    discover: vi.fn(),
}));

/** A discover wire body shaped like the SDK's schemaToWire output. */
const WIRE_BODY = {
    version: "1.0",
    sdk: { language: "typescript", orm: "prisma", server: "web" },
    schema: {
        models: [
            {
                name: "Client",
                tableName: "client",
                fields: [
                    { name: "id", type: "string", isRequired: false, isId: true, hasDefault: true },
                    { name: "name", type: "string", isRequired: true, isId: false, hasDefault: false },
                    { name: "slug", type: "string", isRequired: true, isId: false, hasDefault: false },
                    { name: "status", type: "string", isRequired: false, isId: false, hasDefault: true },
                ],
            },
            {
                name: "User",
                tableName: "user",
                fields: [
                    { name: "id", type: "string", isRequired: false, isId: true, hasDefault: true },
                    { name: "clientId", type: "string", isRequired: true, isId: false, hasDefault: false },
                    { name: "email", type: "string", isRequired: true, isId: false, hasDefault: false },
                    { name: "roles", type: "json", isRequired: true, isId: false, hasDefault: false },
                ],
            },
        ],
        edges: [],
        relations: [],
        scopeField: "clientId",
    },
};

describe("parseDiscoverBody", () => {
    test("parses models, fields, and scopeField from a wire body", () => {
        const schema = parseDiscoverBody(WIRE_BODY)!;
        expect(schema).not.toBeNull();
        expect([...schema.models.keys()].sort()).toEqual(["Client", "User"]);
        expect(schema.scopeField).toBe("clientId");
        expect(schema.models.get("User")!.fields.find((f) => f.name === "clientId")?.isRequired).toBe(true);
    });

    test("returns null for a body without a schema block", () => {
        expect(parseDiscoverBody({ version: "1.0" })).toBeUndefined();
        expect(parseDiscoverBody(null)).toBeUndefined();
        expect(parseDiscoverBody("nope")).toBeUndefined();
    });
});

describe("renderModelSchema", () => {
    test("marks required fields and flags the scope field, omitting the id", () => {
        const schema = parseDiscoverBody(WIRE_BODY)!;
        const rendered = renderModelSchema(schema, "User")!;
        expect(rendered).toContain('"User"');
        expect(rendered).toContain("clientId: string (REQUIRED)");
        expect(rendered).toContain("scope/tenant field");
        expect(rendered).toContain("email: string (REQUIRED)");
        expect(rendered).not.toContain("id: string"); // synthetic id is omitted
    });

    test("treats has-default fields as optional", () => {
        const schema = parseDiscoverBody(WIRE_BODY)!;
        const rendered = renderModelSchema(schema, "Client")!;
        expect(rendered).toContain("status: string (optional (has default))");
    });

    test("returns null for a model the live schema does not know", () => {
        const schema = parseDiscoverBody(WIRE_BODY)!;
        expect(renderModelSchema(schema, "Profile")).toBeUndefined();
    });
});

describe("validateRecipeAgainstSchema", () => {
    const schema: DiscoverSchema = parseDiscoverBody(WIRE_BODY)!;

    test("flags a record missing a required field (e.g. the scope FK)", () => {
        const recipe = {
            User: [{ _alias: "user_1", email: "a@b.com", roles: ["teacher"] }], // no clientId
        };
        const problems = validateRecipeAgainstSchema(recipe, schema);
        expect(problems).toHaveLength(1);
        expect(problems[0]!.model).toBe("User");
        expect(problems[0]!.message).toContain("clientId");
    });

    test("passes when all required fields are present", () => {
        const recipe = {
            Client: [{ _alias: "client_1", name: "North", slug: "north" }],
            User: [{ _alias: "user_1", clientId: { _ref: "client_1" }, email: "a@b.com", roles: ["teacher"] }],
        };
        expect(validateRecipeAgainstSchema(recipe, schema)).toHaveLength(0);
    });

    test("flags a _ref that no record declares as an _alias", () => {
        const recipe = {
            User: [{ _alias: "user_1", clientId: { _ref: "client_99" }, email: "a@b.com", roles: ["x"] }],
        };
        const problems = validateRecipeAgainstSchema(recipe, schema);
        expect(problems.some((p) => p.message.includes("client_99"))).toBe(true);
    });

    test("skips models the live schema does not know (factory not registered yet)", () => {
        const recipe = {
            Profile: [{ _alias: "prof_1", whatever: 1 }], // Profile absent from schema → no required-field assertions
        };
        expect(validateRecipeAgainstSchema(recipe, schema)).toHaveLength(0);
    });
});

describe("formatValidationProblems", () => {
    test("groups messages by model and record index", () => {
        const out = formatValidationProblems([
            { model: "User", recordIndex: 0, message: 'missing required field "clientId" (string)' },
            { model: "User", recordIndex: 0, message: 'missing required field "email" (string)' },
        ]);
        expect(out).toContain("User[0]:");
        expect(out).toContain("clientId");
        expect(out).toContain("email");
    });
});

describe("fetchDiscoverSchema (best-effort)", () => {
    const config = { endpointUrl: "http://localhost:3000/api/autonoma", sharedSecret: "secret" };

    beforeEach(() => vi.mocked(sdk.discover).mockReset());

    test("parses the schema on a 200 response", async () => {
        vi.mocked(sdk.discover).mockResolvedValue({ ok: true, status: 200, body: WIRE_BODY });
        const schema = await fetchDiscoverSchema(config);
        expect(schema?.scopeField).toBe("clientId");
        expect([...schema!.models.keys()].sort()).toEqual(["Client", "User"]);
    });

    test("returns null on a non-ok response instead of throwing", async () => {
        vi.mocked(sdk.discover).mockResolvedValue({ ok: false, status: 401, body: { error: "nope" } });
        expect(await fetchDiscoverSchema(config)).toBeUndefined();
    });

    test("returns null instead of throwing when the response is malformed", async () => {
        // A null/garbage body would make `res.ok` access throw; the catch must swallow it.
        vi.mocked(sdk.discover).mockResolvedValue(null as never);
        expect(await fetchDiscoverSchema(config)).toBeUndefined();
    });
});

// The real pre-send check: the entity loop assembles a multi-model payload
// with buildSingleEntityRecipe, then validates it against the live schema.
// This proves the two compose - a missing required scope FK on the assembled
// closure is caught locally, before any HTTP call.
describe("assembled-payload validation (buildSingleEntityRecipe + validateRecipeAgainstSchema)", () => {
    const schema = parseDiscoverBody(WIRE_BODY)!;

    function model(name: string, createdBy: string[] = []): AuditedModel {
        return { name, independently_created: true, created_by: createdBy.map((owner) => ({ owner })) };
    }
    function progress(entityName: string, recipeData: Record<string, unknown>[]): EntityProgress {
        return { entityName, status: "recipe-accepted", recipeData, errorLog: [] };
    }

    const models = [model("Client"), model("User", ["Client"])];
    const entityOrder = ["Client", "User"];

    test("flags a User whose assembled closure omits the required clientId scope FK", () => {
        const entities: Record<string, EntityProgress> = {
            Client: progress("Client", [{ _alias: "client_1", name: "North", slug: "north" }]),
            // User references the client but never sets the required clientId FK.
            User: progress("User", [{ _alias: "user_1", email: "a@b.com", roles: ["teacher"] }]),
        };
        const recipe = buildSingleEntityRecipe("User", models, entityOrder, entities);
        const problems = validateRecipeAgainstSchema(recipe, schema);
        expect(problems.some((p) => p.model === "User" && p.message.includes("clientId"))).toBe(true);
    });

    test("passes once the scope FK is supplied via _ref", () => {
        const entities: Record<string, EntityProgress> = {
            Client: progress("Client", [{ _alias: "client_1", name: "North", slug: "north" }]),
            User: progress("User", [
                { _alias: "user_1", email: "a@b.com", roles: ["teacher"], clientId: { _ref: "client_1" } },
            ]),
        };
        const recipe = buildSingleEntityRecipe("User", models, entityOrder, entities);
        expect(validateRecipeAgainstSchema(recipe, schema)).toHaveLength(0);
    });
});
