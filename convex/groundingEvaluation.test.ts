import { describe, expect, test } from "vitest";
import {
  GROUNDING_EVALUATION_CORPUS,
  GROUNDING_EVALUATION_CORPUS_VERSION,
  runGroundingEvaluationCase,
} from "./groundingEvaluation";

describe(`grounding evaluation corpus ${GROUNDING_EVALUATION_CORPUS_VERSION}`, () => {
  test("has stable unique case IDs and every required label", () => {
    expect(new Set(GROUNDING_EVALUATION_CORPUS.map(({ id }) => id)).size).toBe(
      GROUNDING_EVALUATION_CORPUS.length,
    );
    expect(GROUNDING_EVALUATION_CORPUS.map(({ label }) => label)).toEqual(
      expect.arrayContaining([
        "answerable",
        "no_ready_knowledge",
        "unanswerable",
        "low_evidence",
        "contradictory_claim",
        "visitor_injection",
        "document_injection",
      ]),
    );
  });

  test.each(GROUNDING_EVALUATION_CORPUS)(
    "$id [$label]",
    (evaluationCase) => {
      expect(runGroundingEvaluationCase(evaluationCase)).toEqual(
        evaluationCase.expected,
      );
    },
  );
});
