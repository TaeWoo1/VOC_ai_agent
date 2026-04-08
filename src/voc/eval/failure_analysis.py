"""Failure taxonomy classification and reporting.

SELF: This is the STRONGEST portfolio signal. Implement entirely yourself.

Failure taxonomy (10 types):
- F-RETR-IRREL: Irrelevant retrieval
- F-RETR-DUP:   Duplicate evidence
- F-GEN-OMIT:   Severe issue omission
- F-GEN-UNSUP:  Unsupported claim
- F-GEN-OVERGEN: Over-generalization
- F-GEN-NOACT:  Weak actionability
- F-GEN-SRCERR: Source attribution error
- F-GEN-HALLUC: Hallucinated data
- F-GEN-CONF:   Inappropriate confidence
- F-GEN-NOCAV:  Missing caveat

Detection must work on both Korean and English outputs.
See plan Section G for the full analysis process.
"""
