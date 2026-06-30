/**
 * Eval for the recipe-builder failure classifier.
 *
 * Unit tests mock the classifier, so they only prove the menu wiring. This eval
 * runs the REAL model against a labeled corpus of failures and reports whether
 * the classifier's verdicts are actually any good - accuracy, plus a confusion
 * matrix, plus a hard check on the only mistakes that really hurt: confusing a
 * recipe-side failure for an implementation-side one or vice versa (a "swap").
 *
 * Run it (loads .env automatically under Bun):
 *   bun run eval:classifier
 *
 * It hits OpenRouter, so it is intentionally NOT part of `vitest run`.
 */
import {
    classifyFailure,
    type ClassifyArgs,
    type FailureSide,
} from "../src/agents/04-recipe-builder/phases/failure-classifier";
import { getModel } from "../src/core/model";

interface Case {
    name: string;
    /** The single most-correct label - used for the swap check. */
    expect: FailureSide;
    /** Verdicts that count as "acceptable" (defaults to just `expect`). */
    accept?: FailureSide[];
    args: ClassifyArgs;
}

const CASES: Case[] = [
    // ---- Clearly RECIPE-side: different data would fix it ----
    {
        name: "recipe: _ref points at a non-existent alias",
        expect: "recipe",
        args: {
            entityName: "Transaction",
            phase: "create",
            httpStatus: 400,
            validRefAliases: "Account: aliases account_1, account_2",
            recipe: { Transaction: [{ _alias: "txn_1", amount: 100, account: { _ref: "account_9" } }] },
            error: { error: "Unknown reference: alias 'account_9' was never created" },
        },
    },
    {
        name: "recipe: unknown field the schema doesn't have",
        expect: "recipe",
        args: {
            entityName: "User",
            phase: "create",
            httpStatus: 400,
            recipe: { User: [{ _alias: "user_1", email: "a@b.com", favoriteColor: "blue" }] },
            error: { message: "Unrecognized key(s) in object: 'favoriteColor'" },
        },
    },
    {
        name: "recipe: type mismatch on a field we sent",
        expect: "recipe",
        args: {
            entityName: "Order",
            phase: "create",
            httpStatus: 400,
            recipe: { Order: [{ _alias: "order_1", total: "not-a-number" }] },
            error: 'invalid input syntax for type numeric: "not-a-number"',
        },
    },
    {
        name: "recipe: invalid enum value we chose",
        expect: "recipe",
        args: {
            entityName: "Subscription",
            phase: "create",
            httpStatus: 400,
            recipe: { Subscription: [{ _alias: "sub_1", status: "banana" }] },
            error: 'invalid input value for enum subscription_status: "banana"',
        },
    },
    {
        name: "recipe: duplicate unique value across two records we sent",
        expect: "recipe",
        args: {
            entityName: "User",
            phase: "create",
            httpStatus: 409,
            recipe: {
                User: [
                    { _alias: "user_1", email: "dupe@b.com" },
                    { _alias: "user_2", email: "dupe@b.com" },
                ],
            },
            error: 'duplicate key value violates unique constraint "users_email_key" - Key (email)=(dupe@b.com) already exists',
        },
    },
    {
        name: "recipe: not-null violation on a column we omitted",
        expect: "recipe",
        accept: ["recipe", "unclear"],
        args: {
            entityName: "Invoice",
            phase: "create",
            httpStatus: 400,
            recipe: { Invoice: [{ _alias: "inv_1", amount: 50 }] },
            error: 'null value in column "customer_id" of relation "invoices" violates not-null constraint',
        },
    },

    // ---- Regression: "unknown alias" / INVALID_BODY errors are RECIPE-side ----
    // The server resolves _refs WITHIN the request body. An alias can sit in the
    // historical valid-targets list yet be absent from (or misspelled in) the
    // payload actually sent - so "references unknown alias(es)" is a data problem
    // the agent can fix, not the developer's handler code. Mislabeling these as
    // implementation (and hiding the autofix) is the exact bug this corpus guards.
    {
        name: "recipe: INVALID_BODY references unknown aliases absent from the sent payload",
        expect: "recipe",
        accept: ["recipe", "unclear"],
        args: {
            entityName: "Profile",
            phase: "create",
            httpStatus: 400,
            // The confound that fooled the old classifier: the aliases ARE valid targets…
            validRefAliases: "Client: aliases client_1\nUser: aliases user_1",
            // …but the payload sent for Profile never includes those parent records.
            recipe: { Profile: [{ _alias: "profile_1", client: { _ref: "client_1" }, user: { _ref: "user_1" } }] },
            error: {
                code: "INVALID_BODY",
                error: "Invalid request body: `create.Profile` references unknown alias(es): client_1, user_1",
            },
        },
    },
    {
        name: "recipe: _ref misspelled vs. the parent record's actual _alias",
        expect: "recipe",
        args: {
            entityName: "Profile",
            phase: "create",
            httpStatus: 400,
            validRefAliases: "User: aliases user_1",
            // User IS in the payload, but Profile references "users_1" (typo), not "user_1".
            recipe: {
                User: [{ _alias: "user_1", email: "a@b.com" }],
                Profile: [{ _alias: "profile_1", user: { _ref: "users_1" } }],
            },
            error: { code: "INVALID_BODY", error: "`create.Profile` references unknown alias(es): users_1" },
        },
    },
    {
        name: "recipe: INVALID_BODY unknown alias for a parent omitted from the request",
        expect: "recipe",
        accept: ["recipe", "unclear"],
        args: {
            entityName: "Order",
            phase: "create",
            httpStatus: 400,
            validRefAliases: "Customer: aliases customer_1, customer_2",
            recipe: { Order: [{ _alias: "order_1", total: 42, customer: { _ref: "customer_1" } }] },
            error: { error: "references unknown alias(es): customer_1", code: "INVALID_BODY" },
        },
    },
    {
        name: "recipe: nested _ref to a sibling that was never declared",
        expect: "recipe",
        args: {
            entityName: "LineItem",
            phase: "create",
            httpStatus: 400,
            validRefAliases: "Order: aliases order_1",
            recipe: { LineItem: [{ _alias: "li_1", order: { _ref: "order_1" }, product: { _ref: "product_7" } }] },
            error: { code: "INVALID_BODY", error: "`create.LineItem` references unknown alias(es): product_7" },
        },
    },

    // ---- Clearly IMPLEMENTATION-side: no data change fixes it ----
    {
        name: "impl: factory not registered for this entity",
        expect: "implementation",
        args: {
            entityName: "AuditLog",
            phase: "create",
            httpStatus: 400,
            entityAudit: "independently_created: true",
            recipe: { AuditLog: [{ _alias: "log_1", action: "login" }] },
            error: { error: "No factory registered for entity 'AuditLog'" },
        },
    },
    {
        name: "impl: handler references a column the recipe never mentioned",
        expect: "implementation",
        args: {
            entityName: "User",
            phase: "create",
            httpStatus: 500,
            recipe: { User: [{ _alias: "user_1", email: "a@b.com", name: "Ada" }] },
            error: 'column "legacy_signup_source" of relation "users" does not exist',
        },
    },
    {
        name: "impl: unhandled null-deref in the create handler",
        expect: "implementation",
        args: {
            entityName: "Cart",
            phase: "create",
            httpStatus: 500,
            recipe: { Cart: [{ _alias: "cart_1", items: [] }] },
            error: "TypeError: Cannot read properties of undefined (reading 'id')\n    at createCart (/app/autonoma/factories.ts:42:18)",
        },
    },
    {
        name: "impl: missing module import crashes the endpoint",
        expect: "implementation",
        args: {
            entityName: "Product",
            phase: "create",
            httpStatus: 500,
            recipe: { Product: [{ _alias: "prod_1", sku: "ABC" }] },
            error: "Error: Cannot find module './services/inventory' imported from /app/autonoma/factories.ts",
        },
    },
    {
        name: "impl: teardown deletes in the wrong order (FK still referenced)",
        expect: "implementation",
        args: {
            entityName: "Account",
            phase: "teardown",
            httpStatus: 500,
            recipe: { Account: [{ _alias: "account_1" }] },
            error: 'update or delete on table "accounts" violates foreign key constraint "transactions_account_id_fkey" on table "transactions"',
        },
    },
    {
        name: "impl: teardown handler throws",
        expect: "implementation",
        args: {
            entityName: "Workspace",
            phase: "teardown",
            httpStatus: 500,
            recipe: { Workspace: [{ _alias: "ws_1" }] },
            error: "TypeError: this.repo.deleteMany is not a function\n    at teardown (/app/autonoma/factories.ts:88:20)",
        },
    },

    // ---- Genuinely AMBIGUOUS: unclear is the honest answer ----
    {
        name: "unclear: bare 500 with no detail",
        expect: "unclear",
        accept: ["unclear", "implementation"],
        args: {
            entityName: "Report",
            phase: "create",
            httpStatus: 500,
            recipe: { Report: [{ _alias: "rep_1", title: "Q3" }] },
            error: "Internal Server Error",
        },
    },
    {
        name: "unclear: generic 'Validation failed' with no field detail",
        expect: "unclear",
        accept: ["unclear", "recipe"],
        args: {
            entityName: "Booking",
            phase: "create",
            httpStatus: 400,
            recipe: { Booking: [{ _alias: "book_1", date: "2026-01-01" }] },
            error: { error: "Validation failed" },
        },
    },
    {
        name: "unclear: connection refused (server not up / infra)",
        expect: "unclear",
        accept: ["unclear", "implementation"],
        args: {
            entityName: "Note",
            phase: "create",
            recipe: { Note: [{ _alias: "note_1", body: "hi" }] },
            error: "fetch failed: connect ECONNREFUSED 127.0.0.1:3000",
        },
    },
    {
        name: "unclear: empty error body, 400",
        expect: "unclear",
        accept: ["unclear", "recipe"],
        args: {
            entityName: "Tag",
            phase: "create",
            httpStatus: 400,
            recipe: { Tag: [{ _alias: "tag_1", label: "x" }] },
            error: {},
        },
    },
];

const SIDES: FailureSide[] = ["recipe", "implementation", "unclear"];
const ACCURACY_THRESHOLD = 0.75;

async function main() {
    const model = getModel();
    console.log(`Running ${CASES.length} cases against ${process.env.OPENROUTER_MODEL ?? "the default model"}…\n`);

    const results = await Promise.all(
        CASES.map(async (c) => {
            const { side, reason } = await classifyFailure(model, c.args);
            const accept = c.accept ?? [c.expect];
            const ok = accept.includes(side);
            // A "swap" is the dangerous mistake: a one-sided case classified as the opposite side.
            const swap =
                (c.expect === "recipe" && side === "implementation") ||
                (c.expect === "implementation" && side === "recipe");
            return { c, got: side, reason, ok, swap };
        }),
    );

    for (const r of results) {
        const mark = r.ok ? "✓" : r.swap ? "✗ SWAP" : "~";
        console.log(`${mark}  [expect ${r.c.expect.padEnd(14)} got ${r.got.padEnd(14)}] ${r.c.name}`);
        if (!r.ok) console.log(`        reason: ${r.reason}`);
    }

    // Confusion matrix (rows = expected, cols = actual).
    const matrix: Record<string, Record<string, number>> = {};
    for (const e of SIDES) matrix[e] = { recipe: 0, implementation: 0, unclear: 0 };
    for (const r of results) matrix[r.c.expect]![r.got]!++;

    console.log("\nConfusion matrix (rows = expected, cols = actual):");
    console.log(`               ${SIDES.map((s) => s.padStart(15)).join("")}`);
    for (const e of SIDES) {
        console.log(`  ${e.padEnd(13)}${SIDES.map((a) => String(matrix[e]![a]).padStart(15)).join("")}`);
    }

    const correct = results.filter((r) => r.ok).length;
    const swaps = results.filter((r) => r.swap);
    const accuracy = correct / results.length;
    console.log(`\nAccuracy: ${correct}/${results.length} (${(accuracy * 100).toFixed(0)}%)`);
    console.log(`Dangerous swaps: ${swaps.length}`);

    const pass = swaps.length === 0 && accuracy >= ACCURACY_THRESHOLD;
    console.log(
        `\n${pass ? "PASS" : "FAIL"} (threshold: 0 swaps, accuracy ≥ ${(ACCURACY_THRESHOLD * 100).toFixed(0)}%)`,
    );
    if (!pass) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
