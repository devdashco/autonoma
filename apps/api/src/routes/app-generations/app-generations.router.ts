import { z } from "zod";
import { protectedProcedure, router } from "../../trpc";

export const applicationSetupsRouter = router({
    getLatest: protectedProcedure
        .input(z.object({ applicationId: z.string() }))
        .query(({ ctx: { services, organizationId }, input }) =>
            services.applicationSetups.getLatest(organizationId, input.applicationId),
        ),

    getById: protectedProcedure
        .input(z.object({ setupId: z.string() }))
        .query(({ ctx: { services, organizationId }, input }) =>
            services.applicationSetups.getById(input.setupId, organizationId),
        ),

    artifactStatus: protectedProcedure
        .input(z.object({ applicationId: z.string() }))
        .query(({ ctx: { services, organizationId }, input }) =>
            services.applicationSetups.artifactStatus(organizationId, input.applicationId),
        ),
});
