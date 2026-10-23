
-- ============================================================================
-- FairWork Pulse
-- V002__rule_based_moderation_policy.sql
-- Purpose: Seed the configurable RULE-BASED review moderation policy.
--
-- This project does NOT depend on an AI/ML moderation service.
--
-- Moderation approach:
--   1. Deterministic REGEX checks
--   2. Version-controlled DICTIONARY checks
--   3. Context-oriented PHRASE/PATTERN checks
--   4. BEHAVIOURAL anti-spam checks
--   5. Weighted risk scoring
--   6. Human Admin review for flagged content
--
-- IMPORTANT:
--   * The engine performs TRIAGE, not automatic rejection.
--   * Negative sentiment is not itself a policy violation.
--   * Quoted/reported abusive language can produce false positives, therefore
--     FLAGGED content is reviewed by an Admin.
--   * HUMAN_APPROVED and HUMAN_REJECTED are never assigned automatically.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO moderation_rules
    (rule_code, category, pattern, pattern_type, severity, weight, enabled, description)
VALUES

-- ============================================================================
-- A. PERSONAL INFORMATION / PRIVACY
-- ============================================================================

(
    'PII_EMAIL_ADDRESS',
    'PERSONAL_INFO',
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'REGEX',
    'HIGH',
    50,
    TRUE,
    'Detects likely email addresses to reduce accidental disclosure of personal contact information.'
),

(
    'PII_UK_MOBILE',
    'PERSONAL_INFO',
    '(?:\+44\s?7\d{3}|0?7\d{3})[\s-]?\d{3}[\s-]?\d{3}',
    'REGEX',
    'HIGH',
    50,
    TRUE,
    'Detects likely UK mobile telephone numbers in review text.'
),

(
    'PII_UK_NATIONAL_INSURANCE',
    'PERSONAL_INFO',
    '\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b',
    'REGEX',
    'CRITICAL',
    70,
    TRUE,
    'Detects text resembling a UK National Insurance number.'
),

-- ============================================================================
-- B. PROFANITY / ABUSIVE VOCABULARY
--
-- The database stores the policy rule, not hundreds of individual words.
-- PROFANITY_EN refers to a version-controlled dictionary loaded by the Worker.
-- A profanity match alone is deliberately below the flagging threshold.
-- ============================================================================

(
    'PROFANITY_GENERAL',
    'PROFANITY',
    'PROFANITY_EN',
    'DICTIONARY',
    'LOW',
    15,
    TRUE,
    'Detects general profanity using a maintained local English dictionary; treated as a supporting signal.'
),

-- ============================================================================
-- C. HARASSMENT
--
-- HARASSMENT_TARGETED_EN is a local phrase/pattern set containing combinations
-- that indicate targeted degrading language rather than isolated vocabulary.
-- ============================================================================

(
    'HARASSMENT_TARGETED_ABUSE',
    'HARASSMENT',
    'HARASSMENT_TARGETED_EN',
    'DICTIONARY',
    'MEDIUM',
    30,
    TRUE,
    'Detects targeted insulting, humiliating or degrading language using maintained contextual phrase patterns.'
),

(
    'HARASSMENT_REPEATED_TARGETING',
    'HARASSMENT',
    NULL,
    'BEHAVIOURAL',
    'MEDIUM',
    30,
    TRUE,
    'Flags repeated abusive submissions directed at the same company/context within a configured period.'
),

-- ============================================================================
-- D. THREATS
--
-- These are high-priority signals. THREAT_DIRECT_EN should contain structured
-- combinations such as intent/action/target patterns rather than a single word.
-- ============================================================================

(
    'THREAT_DIRECT',
    'THREAT',
    'THREAT_DIRECT_EN',
    'DICTIONARY',
    'HIGH',
    60,
    TRUE,
    'Detects direct threat constructions using maintained intent/action/target phrase patterns.'
),

(
    'THREAT_ESCALATED',
    'THREAT',
    'THREAT_ESCALATED_EN',
    'DICTIONARY',
    'CRITICAL',
    80,
    TRUE,
    'Detects strongly escalated threat patterns requiring high-priority human review.'
),

-- ============================================================================
-- E. DISCRIMINATION / EXCLUSIONARY LANGUAGE
--
-- The detector is intentionally contextual because an employee may be quoting
-- discriminatory treatment they experienced. Detection therefore causes review,
-- not automatic rejection.
-- ============================================================================

(
    'DISCRIMINATION_LANGUAGE',
    'DISCRIMINATION',
    'DISCRIMINATION_EN',
    'DICTIONARY',
    'HIGH',
    45,
    TRUE,
    'Detects potentially discriminatory, identity-targeted or exclusionary language for contextual human review.'
),

-- ============================================================================
-- F. SPAM / CONTENT QUALITY
-- ============================================================================

(
    'SPAM_URL_PRESENT',
    'SPAM',
    'https?://',
    'REGEX',
    'LOW',
    10,
    TRUE,
    'Weak signal indicating that an external URL is present in the review.'
),

(
    'SPAM_REPEATED_CHARACTERS',
    'SPAM',
    '(.)\1{9,}',
    'REGEX',
    'LOW',
    15,
    TRUE,
    'Detects unusually long repeated-character sequences that may indicate spam or nonsense.'
),

(
    'SPAM_EXCESSIVE_PUNCTUATION',
    'SPAM',
    '[!?]{8,}',
    'REGEX',
    'LOW',
    10,
    TRUE,
    'Detects excessive repeated punctuation as a weak content-quality signal.'
),

(
    'SPAM_DUPLICATE_REVIEW',
    'SPAM',
    NULL,
    'BEHAVIOURAL',
    'MEDIUM',
    40,
    TRUE,
    'Flags substantially identical review content previously submitted by the same account.'
),

(
    'SPAM_SUBMISSION_VELOCITY',
    'SPAM',
    NULL,
    'BEHAVIOURAL',
    'MEDIUM',
    35,
    TRUE,
    'Flags unusually high review-submission frequency within the configured time window.'
),

(
    'SPAM_MULTIPLE_URLS',
    'SPAM',
    NULL,
    'BEHAVIOURAL',
    'MEDIUM',
    25,
    TRUE,
    'Flags reviews containing multiple external URLs.'
),

(
    'SPAM_MINIMAL_CONTENT',
    'SPAM',
    NULL,
    'BEHAVIOURAL',
    'LOW',
    10,
    TRUE,
    'Detects extremely short or low-information review content as a weak quality signal.'
)

ON DUPLICATE KEY UPDATE
    category = VALUES(category),
    pattern = VALUES(pattern),
    pattern_type = VALUES(pattern_type),
    severity = VALUES(severity),
    weight = VALUES(weight),
    enabled = VALUES(enabled),
    description = VALUES(description),
    updated_at = CURRENT_TIMESTAMP;


-- ============================================================================

-- ============================================================================
