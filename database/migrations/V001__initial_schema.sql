-- ============================================================================
-- FairWork Pulse
-- V001__initial_schema.sql
-- Initial Amazon RDS MySQL schema
--
-- Creates the complete application data model used by FairWork Pulse.
-- V002 seeds the rule-based moderation policy.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1. USER PROFILES
-- Cognito remains responsible for authentication and role/group membership.
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cognito_sub VARCHAR(64) NOT NULL,
    display_name VARCHAR(100) NULL,
    account_status ENUM('ACTIVE','SUSPENDED','DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_user_profiles_cognito_sub (cognito_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
    company_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    industry VARCHAR(100) NULL,
    location VARCHAR(150) NULL,
    description TEXT NULL,
    website VARCHAR(255) NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id),
    KEY idx_companies_name (name),
    KEY idx_companies_status (status),
    CONSTRAINT fk_companies_created_by
        FOREIGN KEY (created_by) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. WORKPLACE ASSOCIATIONS
-- Supports a user having worked for multiple companies and retaining history
-- when moving from one employer to another.
CREATE TABLE IF NOT EXISTS workplace_associations (
    association_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    company_id BIGINT UNSIGNED NOT NULL,
    status ENUM('VERIFIED','EXPIRED','LEFT') NOT NULL DEFAULT 'VERIFIED',
    verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL DEFAULT NULL,
    ended_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (association_id),
    KEY idx_workplace_user (user_id),
    KEY idx_workplace_company (company_id),
    KEY idx_workplace_user_company_status (user_id, company_id, status),
    CONSTRAINT fk_workplace_user
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_workplace_company
        FOREIGN KEY (company_id) REFERENCES companies(company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. EMPLOYER COMPANY ACCESS
-- Maps an authenticated employer account to the company it is allowed to manage.
CREATE TABLE IF NOT EXISTS employer_company_access (
    access_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    company_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
    granted_by BIGINT UNSIGNED NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (access_id),
    UNIQUE KEY uq_employer_company (user_id, company_id),
    KEY idx_employer_access_company (company_id),
    KEY idx_employer_access_status (status),
    CONSTRAINT fk_employer_access_user
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_employer_access_company
        FOREIGN KEY (company_id) REFERENCES companies(company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_employer_access_granted_by
        FOREIGN KEY (granted_by) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. VERIFICATION CODES
-- Store only a hash of the code, never the plaintext verification code.
CREATE TABLE IF NOT EXISTS verification_codes (
    code_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    status ENUM('UNUSED','USED','EXPIRED','REVOKED') NOT NULL DEFAULT 'UNUSED',
    created_by BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_by_user_id BIGINT UNSIGNED NULL,
    used_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (code_id),
    UNIQUE KEY uq_verification_code_hash (code_hash),
    KEY idx_verification_company_status (company_id, status),
    KEY idx_verification_expiry (expires_at),
    CONSTRAINT fk_verification_company
        FOREIGN KEY (company_id) REFERENCES companies(company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_verification_created_by
        FOREIGN KEY (created_by) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_verification_used_by
        FOREIGN KEY (used_by_user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. REVIEWS
CREATE TABLE IF NOT EXISTS reviews (
    review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    company_id BIGINT UNSIGNED NOT NULL,
    workplace_association_id BIGINT UNSIGNED NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    review_title VARCHAR(150) NULL,
    review_text TEXT NOT NULL,
    moderation_status ENUM(
        'PENDING_ANALYSIS',
        'CLEAN',
        'FLAGGED',
        'HUMAN_APPROVED',
        'HUMAN_REJECTED',
        'ANALYSIS_FAILED'
    ) NOT NULL DEFAULT 'PENDING_ANALYSIS',
    moderation_score TINYINT UNSIGNED NULL,
    moderation_reason VARCHAR(500) NULL,
    moderated_by BIGINT UNSIGNED NULL,
    moderated_at TIMESTAMP NULL DEFAULT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id),
    KEY idx_reviews_user (user_id),
    KEY idx_reviews_company (company_id),
    KEY idx_reviews_association (workplace_association_id),
    KEY idx_reviews_moderation_status (moderation_status),
    KEY idx_reviews_company_status (company_id, moderation_status),
    KEY idx_reviews_submitted_at (submitted_at),
    CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT chk_reviews_moderation_score
        CHECK (moderation_score IS NULL OR moderation_score BETWEEN 0 AND 100),
    CONSTRAINT fk_reviews_user
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reviews_company
        FOREIGN KEY (company_id) REFERENCES companies(company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reviews_workplace_association
        FOREIGN KEY (workplace_association_id) REFERENCES workplace_associations(association_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reviews_moderated_by
        FOREIGN KEY (moderated_by) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. EMPLOYER RESPONSES
-- One official employer response per review in the initial application design.
CREATE TABLE IF NOT EXISTS employer_responses (
    response_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    review_id BIGINT UNSIGNED NOT NULL,
    employer_user_id BIGINT UNSIGNED NOT NULL,
    response_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (response_id),
    UNIQUE KEY uq_employer_response_review (review_id),
    KEY idx_employer_responses_user (employer_user_id),
    CONSTRAINT fk_employer_response_review
        FOREIGN KEY (review_id) REFERENCES reviews(review_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_employer_response_user
        FOREIGN KEY (employer_user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. WELLBEING CHECK-INS
CREATE TABLE IF NOT EXISTS wellbeing_checkins (
    checkin_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    company_id BIGINT UNSIGNED NOT NULL,
    workplace_association_id BIGINT UNSIGNED NOT NULL,
    workload TINYINT UNSIGNED NOT NULL,
    stress TINYINT UNSIGNED NOT NULL,
    shift_pressure TINYINT UNSIGNED NOT NULL,
    work_life_balance TINYINT UNSIGNED NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (checkin_id),
    KEY idx_wellbeing_user (user_id),
    KEY idx_wellbeing_company (company_id),
    KEY idx_wellbeing_association (workplace_association_id),
    KEY idx_wellbeing_company_submitted (company_id, submitted_at),
    CONSTRAINT chk_wellbeing_workload CHECK (workload BETWEEN 1 AND 5),
    CONSTRAINT chk_wellbeing_stress CHECK (stress BETWEEN 1 AND 5),
    CONSTRAINT chk_wellbeing_shift_pressure CHECK (shift_pressure BETWEEN 1 AND 5),
    CONSTRAINT chk_wellbeing_work_life_balance CHECK (work_life_balance BETWEEN 1 AND 5),
    CONSTRAINT fk_wellbeing_user
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wellbeing_company
        FOREIGN KEY (company_id) REFERENCES companies(company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wellbeing_workplace_association
        FOREIGN KEY (workplace_association_id) REFERENCES workplace_associations(association_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. MODERATION RULES
-- Configuration for the explainable rule-based moderation engine.
CREATE TABLE IF NOT EXISTS moderation_rules (
    rule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rule_code VARCHAR(80) NOT NULL,
    category ENUM(
        'PROFANITY',
        'HARASSMENT',
        'THREAT',
        'DISCRIMINATION',
        'PERSONAL_INFO',
        'SPAM'
    ) NOT NULL,
    pattern VARCHAR(500) NULL,
    pattern_type ENUM(
        'KEYWORD',
        'PHRASE',
        'REGEX',
        'DICTIONARY',
        'BEHAVIOURAL'
    ) NOT NULL,
    severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    weight TINYINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id),
    UNIQUE KEY uq_moderation_rules_rule_code (rule_code),
    KEY idx_moderation_rules_enabled (enabled),
    KEY idx_moderation_rules_category (category),
    CONSTRAINT chk_moderation_rule_weight CHECK (weight BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. MODERATION EVENTS
-- Explainable audit trail: records exactly which rules contributed to a review's
-- moderation result.
CREATE TABLE IF NOT EXISTS moderation_events (
    event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    review_id BIGINT UNSIGNED NOT NULL,
    rule_id BIGINT UNSIGNED NULL,
    rule_code VARCHAR(80) NOT NULL,
    category ENUM(
        'PROFANITY',
        'HARASSMENT',
        'THREAT',
        'DISCRIMINATION',
        'PERSONAL_INFO',
        'SPAM'
    ) NOT NULL,
    severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
    score_contribution TINYINT UNSIGNED NOT NULL,
    evidence VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id),
    KEY idx_moderation_events_review (review_id),
    KEY idx_moderation_events_rule (rule_id),
    KEY idx_moderation_events_category (category),
    KEY idx_moderation_events_created (created_at),
    CONSTRAINT chk_moderation_event_score
        CHECK (score_contribution BETWEEN 0 AND 100),
    CONSTRAINT fk_moderation_events_review
        FOREIGN KEY (review_id) REFERENCES reviews(review_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_moderation_events_rule
        FOREIGN KEY (rule_id) REFERENCES moderation_rules(rule_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
