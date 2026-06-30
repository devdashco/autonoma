export interface VariationCoverage {
    possibleValues: string[];
    testedValues: string[];
}

export interface EntityCoverage {
    testedInTests: string[];
    variations: Record<string, VariationCoverage>;
}

export type EntityCoverageMap = Record<string, EntityCoverage>;

export function emptyEntityCoverage(): EntityCoverageMap {
    return {};
}

export function recordEntityTest(map: EntityCoverageMap, entityName: string, testPath: string): void {
    if (!map[entityName]) {
        map[entityName] = { testedInTests: [], variations: {} };
    }
    if (!map[entityName].testedInTests.includes(testPath)) {
        map[entityName].testedInTests.push(testPath);
    }
}

export function recordVariation(map: EntityCoverageMap, entityName: string, fieldName: string, value: string): void {
    if (!map[entityName]) {
        map[entityName] = { testedInTests: [], variations: {} };
    }
    const entity = map[entityName];
    if (!entity.variations[fieldName]) {
        entity.variations[fieldName] = { possibleValues: [], testedValues: [] };
    }
    const variation = entity.variations[fieldName];
    if (!variation.testedValues.includes(value)) {
        variation.testedValues.push(value);
    }
}

export function setPossibleValues(
    map: EntityCoverageMap,
    entityName: string,
    fieldName: string,
    values: string[],
): void {
    if (!map[entityName]) {
        map[entityName] = { testedInTests: [], variations: {} };
    }
    const entity = map[entityName];
    if (!entity.variations[fieldName]) {
        entity.variations[fieldName] = { possibleValues: values, testedValues: [] };
    } else {
        entity.variations[fieldName].possibleValues = values;
    }
}

export interface CoverageReport {
    routes: { explored: number; total: number; percentage: number };
    files: { visited: number; total: number; percentage: number };
    entities: {
        name: string;
        testCount: number;
        variations: {
            field: string;
            tested: string[];
            missing: string[];
        }[];
    }[];
}

export function buildCoverageReport(
    entityMap: EntityCoverageMap,
    routeStats: { explored: number; total: number },
    fileStats: { visited: number; total: number },
): CoverageReport {
    const entities = Object.entries(entityMap).map(([name, coverage]) => ({
        name,
        testCount: coverage.testedInTests.length,
        variations: Object.entries(coverage.variations).map(([field, v]) => ({
            field,
            tested: v.testedValues,
            missing: v.possibleValues.filter((p) => !v.testedValues.includes(p)),
        })),
    }));

    return {
        routes: {
            explored: routeStats.explored,
            total: routeStats.total,
            percentage: routeStats.total > 0 ? Math.round((routeStats.explored / routeStats.total) * 100) : 0,
        },
        files: {
            visited: fileStats.visited,
            total: fileStats.total,
            percentage: fileStats.total > 0 ? Math.round((fileStats.visited / fileStats.total) * 100) : 0,
        },
        entities,
    };
}

export function formatCoverageReport(report: CoverageReport): string {
    const lines: string[] = [];

    lines.push(
        `Route coverage:   ${report.routes.explored}/${report.routes.total} routes (${report.routes.percentage}%)`,
    );
    lines.push(
        `File coverage:    ${report.files.visited}/${report.files.total} source files (${report.files.percentage}%)`,
    );

    if (report.entities.length > 0) {
        lines.push(`Entity coverage:  ${report.entities.length} entity types referenced in tests`);
        for (const entity of report.entities) {
            for (const v of entity.variations) {
                const testedStr = v.tested.map((t) => `${t} +`).join(", ");
                const missingStr = v.missing.map((m) => `${m} -`).join(", ");
                const all = [testedStr, missingStr].filter(Boolean).join(", ");
                lines.push(`  ${entity.name}: ${v.field} [${all}]`);
            }
        }
    }

    return lines.join("\n");
}
