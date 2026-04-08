"""Eval suite runner — orchestrates end-to-end evaluation.

SELF: This is a core design file. Implement the eval runner yourself:
- Load eval dataset (queries + gold references + annotations)
- Run pipeline for each eval query
- Compute all metrics (retrieval + generation)
- Invoke LLM-as-judge for qualitative scores
- Produce structured EvalReport
- Pass report to failure_analysis for taxonomy classification
"""
