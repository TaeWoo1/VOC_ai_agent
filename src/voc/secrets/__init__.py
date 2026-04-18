"""Secrets — credential storage abstraction.

SecretsPort protocol with managed (cloud secret manager) and local (SOPS+age)
implementations. Postgres only stores opaque secret_ref pointers; secret material
never lives in the application database. TokenManager handles OAuth refresh with
a per-secret_ref Redis lock. See plan §F.M2 contract list.

Empty in M0; port + local impl + token_manager land in M2.
"""
