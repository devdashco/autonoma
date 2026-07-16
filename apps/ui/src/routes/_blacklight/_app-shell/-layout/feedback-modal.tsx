import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  Textarea,
  cn,
} from "@autonoma/blacklight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import {
  type FeedbackResponses,
  type FeedbackSurvey,
  type MultipleSurveyQuestion,
  type RatingSurveyQuestion,
  type SurveyQuestion,
  SurveyQuestionType,
  type SurveyResponseValue,
  captureFeedbackDismissed,
  captureFeedbackShown,
  loadFeedbackSurvey,
  submitFeedback,
} from "lib/feedback-survey";
import { toastManager } from "lib/toast-manager";
import { useEffect, useState } from "react";

const OPEN_PLACEHOLDER = "Tell us what's on your mind...";

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const { state, reload } = useFeedbackSurvey(open);
  const survey = state.status === "ready" ? state.survey : undefined;
  const [responses, setResponses] = useState<FeedbackResponses>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open || survey == null) return;
    setResponses({});
    setSubmitted(false);
    captureFeedbackShown(survey);
  }, [open, survey]);

  const setResponse = (questionId: string, value: SurveyResponseValue) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !submitted && survey != null) captureFeedbackDismissed(survey);
    onOpenChange(next);
  };

  const handleSubmit = () => {
    if (survey == null) return;
    submitFeedback(survey, responses);
    setSubmitted(true);
    toastManager.add({ type: "success", title: "Thanks for the feedback!" });
    onOpenChange(false);
  };

  const canSubmit = survey != null && survey.questions.every((question) => isQuestionSatisfied(question, responses));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogBackdrop />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share your feedback</DialogTitle>
          <DialogDescription>
            You're using an early version of Autonoma. Tell us what's working and what isn't.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          {state.status === "loading" && <FeedbackModalSkeleton />}
          {state.status === "unavailable" && <FeedbackModalUnavailable onRetry={reload} />}
          {state.status === "ready" &&
            state.survey.questions.map((question) => (
              <QuestionField
                key={question.id ?? question.question}
                question={question}
                value={question.id != null ? responses[question.id] : undefined}
                onChange={(value) => {
                  if (question.id != null) setResponse(question.id, value);
                }}
              />
            ))}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            Send feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FeedbackSurveyState =
  | { status: "loading" }
  | { status: "ready"; survey: FeedbackSurvey }
  | { status: "unavailable" };

function useFeedbackSurvey(open: boolean): { state: FeedbackSurveyState; reload: () => void } {
  const [state, setState] = useState<FeedbackSurveyState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    void loadFeedbackSurvey().then((survey) => {
      if (cancelled) return;
      setState(survey != null ? { status: "ready", survey } : { status: "unavailable" });
    });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  return { state, reload: () => setAttempt((previous) => previous + 1) };
}

function FeedbackModalUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <p className="text-xs text-text-secondary">We couldn't load the feedback form. Please try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyResponseValue | undefined;
  onChange: (value: SurveyResponseValue) => void;
}) {
  const isRequired = question.optional !== true;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-text-primary">
        {question.question}
        {isRequired && <span className="text-status-critical"> *</span>}
      </Label>
      {question.description != null && question.description !== "" && (
        <p className="text-2xs text-text-secondary">{question.description}</p>
      )}
      <QuestionInput question={question} value={value} onChange={onChange} />
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyResponseValue | undefined;
  onChange: (value: SurveyResponseValue) => void;
}) {
  if (question.type === SurveyQuestionType.Rating) {
    return <RatingInput question={question} value={value} onChange={onChange} />;
  }

  if (question.type === SurveyQuestionType.SingleChoice || question.type === SurveyQuestionType.MultipleChoice) {
    return <ChoiceInput question={question} value={value} onChange={onChange} />;
  }

  return (
    <Textarea
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.type === SurveyQuestionType.Open ? OPEN_PLACEHOLDER : undefined}
      rows={4}
    />
  );
}

function RatingInput({
  question,
  value,
  onChange,
}: {
  question: RatingSurveyQuestion;
  value: SurveyResponseValue | undefined;
  onChange: (value: SurveyResponseValue) => void;
}) {
  const ratings = Array.from({ length: question.scale }, (_, index) => index + 1);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {ratings.map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className={cn(
              "flex h-9 flex-1 cursor-pointer items-center justify-center border font-mono text-xs transition-colors",
              value === rating
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-mid text-text-secondary hover:border-border-highlight hover:text-text-primary",
            )}
          >
            {rating}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-3xs text-text-secondary">
        <span>{question.lowerBoundLabel}</span>
        <span>{question.upperBoundLabel}</span>
      </div>
    </div>
  );
}

function ChoiceInput({
  question,
  value,
  onChange,
}: {
  question: MultipleSurveyQuestion;
  value: SurveyResponseValue | undefined;
  onChange: (value: SurveyResponseValue) => void;
}) {
  const isMultiple = question.type === SurveyQuestionType.MultipleChoice;
  const selected = selectedChoices(value);

  const toggle = (choice: string) => {
    if (!isMultiple) {
      onChange(choice);
      return;
    }
    const next = selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected, choice];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {question.choices.map((choice) => {
        const active = selected.includes(choice);
        return (
          <button
            key={choice}
            type="button"
            onClick={() => toggle(choice)}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 border px-3 py-2 text-left font-mono text-xs transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-mid text-text-secondary hover:border-border-highlight hover:text-text-primary",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center border",
                isMultiple ? "rounded-none" : "rounded-full",
                active ? "border-primary bg-primary" : "border-border-mid",
              )}
            >
              {active && <CheckIcon size={10} weight="bold" className="text-primary-foreground" />}
            </span>
            {choice}
          </button>
        );
      })}
    </div>
  );
}

function FeedbackModalSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function selectedChoices(value: SurveyResponseValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

function isQuestionSatisfied(question: SurveyQuestion, responses: FeedbackResponses): boolean {
  if (question.optional === true) return true;
  if (question.id == null) return true;
  return isAnswered(responses[question.id]);
}

function isAnswered(value: SurveyResponseValue | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
