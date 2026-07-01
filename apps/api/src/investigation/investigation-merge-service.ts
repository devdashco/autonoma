import { db } from "@autonoma/db";
import { triggerInvestigationMergeJob } from "@autonoma/workflow";
import { InvestigationMergeTriggerService } from "./investigation-merge-trigger.service";

export const investigationMergeTriggerService = new InvestigationMergeTriggerService(db, triggerInvestigationMergeJob);
