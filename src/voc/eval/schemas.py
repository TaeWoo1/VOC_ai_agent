"""Evaluation schemas — EvalQuery, GoldReference, EvalRubric, EvalResult.

SELF: This is a core design file and the key differentiator.
Design the eval schema structure yourself:
- EvalQuery with query_language, category (from taxonomy), difficulty
- GoldReference with retrieval gold, generation gold, per-query rubric
- EvalRubric with criteria descriptions (written in query language)
- EvalResult with quantitative + qualitative scores
- EvidenceAnnotation with topics, sentiment, severity, query relevance
- FailureCaseAnalysis with failure_code, examples, root cause, mitigation

Refer to the plan (Section E) for taxonomy and rubric design guidance.
"""
