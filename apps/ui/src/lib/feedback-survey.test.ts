import { describe, expect, it } from "vitest";
import { type FeedbackSurvey, SurveyQuestionType, buildSentProperties } from "./feedback-survey";

const SURVEY: FeedbackSurvey = {
    id: "survey-abc",
    name: "Feedback",
    current_iteration: null,
    current_iteration_start_date: null,
    questions: [
        {
            type: SurveyQuestionType.Rating,
            id: "q-rating",
            question: "Rate us",
            display: "number",
            scale: 5,
            lowerBoundLabel: "Poor",
            upperBoundLabel: "Great",
        },
        { type: SurveyQuestionType.Open, id: "q-open", question: "Why?", optional: true },
    ],
};

describe("buildSentProperties", () => {
    it("keys each response by $survey_response_<questionId> so PostHog maps it to the question", () => {
        const props = buildSentProperties(SURVEY, { "q-rating": 4, "q-open": "loved it" });

        expect(props["$survey_response_q-rating"]).toBe(4);
        expect(props["$survey_response_q-open"]).toBe("loved it");
    });

    it("carries survey identity and a completion flag", () => {
        const props = buildSentProperties(SURVEY, { "q-rating": 4, "q-open": "" });

        expect(props.$survey_id).toBe("survey-abc");
        expect(props.$survey_name).toBe("Feedback");
        expect(props.$survey_completed).toBe(true);
    });

    it("embeds each question alongside its response in $survey_questions", () => {
        const props = buildSentProperties(SURVEY, { "q-rating": 4, "q-open": "loved it" });

        expect(props.$survey_questions).toEqual([
            { id: "q-rating", question: "Rate us", response: 4 },
            { id: "q-open", question: "Why?", response: "loved it" },
        ]);
    });

    it("sends null for an unanswered question rather than dropping it", () => {
        const props = buildSentProperties(SURVEY, { "q-rating": 5 });

        expect(props["$survey_response_q-open"]).toBeNull();
    });

    it("marks the person as responded so the survey is not reshown", () => {
        const props = buildSentProperties(SURVEY, { "q-rating": 5 });

        expect(props.$set).toEqual({ "$survey_responded/survey-abc": true });
    });

    it("scopes the responded key to the iteration for recurring surveys", () => {
        const recurring: FeedbackSurvey = { ...SURVEY, current_iteration: 2 };

        const props = buildSentProperties(recurring, { "q-rating": 5 });

        expect(props.$set).toEqual({ "$survey_responded/survey-abc/2": true });
    });
});
