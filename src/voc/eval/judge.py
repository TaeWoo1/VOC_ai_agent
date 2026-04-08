"""LLM-as-judge — qualitative rubric scoring via stronger model.

SELF: This is a core design file. Implement the judge yourself:
- Rubric prompt design (criteria descriptions in query language)
- Use stronger model (gpt-4o) to judge output of weaker model (gpt-4o-mini)
- Score: actionability, caveat_appropriateness, overall quality
- Must produce sensible scores for both Korean and English text
- Document the same-model-family limitation in eval design docs
"""
