import { integrationTestSuite } from "@autonoma/integration-test";
import type { TestAPI } from "vitest";
import { APITestHarness } from "./harness";

interface ApiTestParams<TSeedResult> {
    name: string;
    seed?: (params: { harness: APITestHarness }) => Promise<TSeedResult>;
    cases: (test: TestAPI<{ harness: APITestHarness; seedResult: TSeedResult }>) => void;
}

export function apiTestSuite<TSeedResult>({ name, seed, cases }: ApiTestParams<TSeedResult>) {
    integrationTestSuite<APITestHarness, TSeedResult>({
        name,
        createHarness: () => APITestHarness.create(),
        seed: seed != null ? (harness) => seed({ harness }) : undefined,
        cases,
    });
}
