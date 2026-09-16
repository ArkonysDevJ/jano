-- ============================================================
-- Jano — database schema (NestJS/PostgreSQL)
-- Source: docs/ARCHITECTURE-01.md, section 12
--
-- Minimal DDL, no schema decisions beyond what the architecture doc
-- declares. No indexes, no secondary constraints, no exhaustive audit
-- timestamps -- that is an implementation detail (section 12), not
-- architecture. This file is the starting point for the first real
-- migration, not a migration tool itself -- see docs/TESTING-01.md
-- section 4 for environment setup and the repo root's
-- docker-compose.yml, which mounts this file so a fresh local Postgres
-- container applies it automatically on first start.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- OPAQUE identity of the user (sections 4, 12).
-- Library chosen: @cloudflare/opaque-ts@0.7.5.
--
-- CORRECTION (after reading the library's real .d.ts files): oprf_seed
-- does NOT belong in this table. It is a secret UNIQUE to the whole
-- server deployment -- OpaqueServer receives it once in its
-- constructor and internally derives each user's OPRF key from that
-- global seed plus their email (credential identifier). It lives in
-- the OPAQUE_OPRF_SEED_B64 environment variable (see
-- apps/api/.env.example and cloudflare-opaque-server-provider.ts),
-- never in a per-user column -- storing it per row would have been
-- cryptographically useless (always the same value) and a leak
-- surface with no benefit.
CREATE TABLE users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email               text NOT NULL UNIQUE,
    client_public_key   bytea,
    -- OPAQUE record the client issues when CLOSING registration
    -- (section 4). This is what the server uses on every login to
    -- validate the handshake; it never allows reconstructing the
    -- password or any vault key. Null until the user completes
    -- register/finish.
    registration_record bytea,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Section 13, Factor 2 ("hardened mode"), opt-in at registration
    -- (see auth/dto/register-finish.dto.ts's continuitySecret field).
    -- When true, `pending_opaque_rotation` re-registration additionally
    -- requires a continuity signature proving possession of
    -- continuity_secret over a server-issued nonce -- see
    -- rotation/rotation.service.ts for the full authorization policy
    -- and an explicit note on why this stores a shared secret rather
    -- than a pure asymmetric verifier. Added 2026-09-12, after the
    -- initial version of this file -- persistence/entities.ts is the
    -- source of truth if this file and the code ever disagree again.
    hardened_mode_enabled boolean NOT NULL DEFAULT false,
    continuity_secret    bytea
);

-- Devices registered per user, for multi-device sync traceability
-- (section 12) and as the anchor for Factor 1 of OPAQUE re-registration
-- (section 13 -- a valid session/refresh token per device).
CREATE TABLE devices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label               text,
    last_seen_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Section 13, Factor 2 ("hardened mode") rotation challenge.
    -- Persists the single outstanding nonce-challenge RotationService
    -- issues from rotate/start and verifies in rotate/finish (see
    -- rotation.service.ts and DevicesRepository.setPendingRotationChallenge
    -- / getPendingRotationChallenge / clearPendingRotationChallenge).
    -- Was an in-memory Map before persistence moved to real Postgres --
    -- lost on every process restart, which would silently strand an
    -- in-flight hardened-mode rotation between start and finish. Both
    -- columns are NULL exactly together: a pending rotation exists iff
    -- pending_rotation_challenge_at is non-null. Superseded (never
    -- accumulated) by a fresh rotate/start call before finish. Added
    -- 2026-09-12, same pass as the Postgres repository classes --
    -- persistence/entities.ts is the source of truth if this file and
    -- the code ever disagree again.
    pending_rotation_challenge    bytea,
    pending_rotation_challenge_at timestamptz
);

-- Wrappings of the vault's SINGLE DEK (sections 3, 7).
-- Normally 2 active rows per user: purpose = 'master' | 'recovery'.
-- master_key_version and recovery_key_version are INDEPENDENT fields
-- (section 3) -- rotating one must not touch the other's version.
-- Modeled here as a single key_version field per row, with purpose
-- distinguishing which of the two it corresponds to -- equivalent to
-- the two independent fields described in section 3, without
-- duplicating the column.
CREATE TABLE vault_keys (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose             text NOT NULL CHECK (purpose IN ('master', 'recovery')),
    -- Output of aes-gcm.ts packSealed(): nonce (12 bytes) + ciphertext + tag.
    wrapped_dek         bytea NOT NULL,
    key_version         integer NOT NULL DEFAULT 1,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, purpose)
);

-- Individual credential records (sections 7, 12).
-- NEVER contains a key wrapping -- that lives exclusively in
-- vault_keys. dek_version is a generation TAG for the DEK (a rare
-- full-rotation event), not a wrapping.
CREATE TABLE vault_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Output of aes-gcm.ts packSealed() under the current DEK (section 5).
    ciphertext          bytea NOT NULL,
    dek_version         integer NOT NULL DEFAULT 1,
    -- Native to WatermelonDB, used by the conflict algorithm (section 14).
    item_version        bigint NOT NULL DEFAULT 1,
    -- Points to the original item when this record is a conflict fork
    -- (section 14) -- null in the normal case.
    conflict_of         uuid REFERENCES vault_items(id),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Per-operation sync metadata (sections 7, 12). The key-reconciliation
-- gate compares against master_key_version WITHOUT touching content --
-- it's blind metadata, no decryption required.
CREATE TABLE sync_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id           uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    master_key_version  integer NOT NULL,
    updated_at_server   timestamptz NOT NULL DEFAULT now()
);
