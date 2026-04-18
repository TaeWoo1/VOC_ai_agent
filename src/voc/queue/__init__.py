"""Queue — job dispatch abstraction.

QueuePort protocol with arq (Redis) implementation for production and an in-memory
implementation for tests. Application services enqueue via the port; they never
import the arq library directly. See plan §F.M2 contract list.

Empty in M0; port + arq impl land in M2.
"""
