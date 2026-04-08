"""Evaluation metrics — retrieval and generation quality measures.

SELF: This is a core design file. Implement all metrics yourself:

Retrieval metrics:
- precision_at_k, recall_at_k, mrr, ndcg_at_k
- source_diversity, language_match_rate

Generation metrics:
- theme_coverage, pain_point_coverage, fact_recall
- unsupported_claim_rate, citation_accuracy
- actionability_score, caveat_appropriateness (via LLM-as-judge)

See plan Section E.4 for full metric definitions.
"""
