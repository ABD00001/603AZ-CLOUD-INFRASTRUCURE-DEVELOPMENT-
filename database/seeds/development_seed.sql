-- ============================================================================
-- FairWork Pulse
-- development_seed.sql
-- Development/demo data for the FairWork Pulse MySQL database.
--
-- IMPORTANT
-- * Run V001 and V002 before this file.
-- * DEVELOPMENT / DEMONSTRATION USE ONLY.
-- * Do not use these synthetic Cognito identifiers as production identities.
-- * Verification codes are intentionally NOT seeded because production codes
--   should be generated securely and stored only as hashes.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

-- ============================================================================
-- 1. SYNTHETIC USER PROFILES
-- These IDs allow the database/API to be developed before final Cognito
-- integration. Later, real cognito_sub values will come from Cognito tokens.
-- ============================================================================

INSERT INTO user_profiles (cognito_sub, display_name, account_status)
VALUES
    ('dev-employee-001', 'Demo Employee One', 'ACTIVE'),
    ('dev-employee-002', 'Demo Employee Two', 'ACTIVE'),
    ('dev-employer-001', 'Demo Employer One', 'ACTIVE'),
    ('dev-employer-002', 'Demo Employer Two', 'ACTIVE'),
    ('dev-admin-001',    'Demo Administrator', 'ACTIVE')
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    account_status = VALUES(account_status);

-- ============================================================================
-- 2. COMPANIES
-- Entirely fictional organisations for development/demo purposes.
-- ============================================================================

INSERT INTO companies
    (name, industry, location, description, website, status, created_by)
SELECT
    'Northstar Retail Ltd',
    'Retail',
    'London, UK',
    'Synthetic retail organisation used for FairWork Pulse development.',
    NULL,
    'ACTIVE',
    u.user_id
FROM user_profiles u
WHERE u.cognito_sub = 'dev-admin-001'
  AND NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.name = 'Northstar Retail Ltd'
  );

INSERT INTO companies
    (name, industry, location, description, website, status, created_by)
SELECT
    'Apex Logistics Ltd',
    'Logistics',
    'Cambridge, UK',
    'Synthetic logistics organisation used for FairWork Pulse development.',
    NULL,
    'ACTIVE',
    u.user_id
FROM user_profiles u
WHERE u.cognito_sub = 'dev-admin-001'
  AND NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.name = 'Apex Logistics Ltd'
  );

INSERT INTO companies
    (name, industry, location, description, website, status, created_by)
SELECT
    'Greenfield Technologies Ltd',
    'Technology',
    'Manchester, UK',
    'Synthetic technology organisation used for FairWork Pulse development.',
    NULL,
    'ACTIVE',
    u.user_id
FROM user_profiles u
WHERE u.cognito_sub = 'dev-admin-001'
  AND NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.name = 'Greenfield Technologies Ltd'
  );

-- ============================================================================
-- 3. EMPLOYER -> COMPANY ACCESS
-- Demonstrates that employer authentication and company authorisation are
-- separate concerns.
-- ============================================================================

INSERT INTO employer_company_access (user_id, company_id, status, granted_by)
SELECT employer.user_id, company.company_id, 'ACTIVE', admin_user.user_id
FROM user_profiles employer
JOIN companies company ON company.name = 'Northstar Retail Ltd'
JOIN user_profiles admin_user ON admin_user.cognito_sub = 'dev-admin-001'
WHERE employer.cognito_sub = 'dev-employer-001'
ON DUPLICATE KEY UPDATE
    status = 'ACTIVE',
    granted_by = VALUES(granted_by),
    revoked_at = NULL;

INSERT INTO employer_company_access (user_id, company_id, status, granted_by)
SELECT employer.user_id, company.company_id, 'ACTIVE', admin_user.user_id
FROM user_profiles employer
JOIN companies company ON company.name = 'Greenfield Technologies Ltd'
JOIN user_profiles admin_user ON admin_user.cognito_sub = 'dev-admin-001'
WHERE employer.cognito_sub = 'dev-employer-002'
ON DUPLICATE KEY UPDATE
    status = 'ACTIVE',
    granted_by = VALUES(granted_by),
    revoked_at = NULL;

-- ============================================================================
-- 4. WORKPLACE ASSOCIATIONS
-- Employee One demonstrates company history:
--   * previously worked for Apex Logistics
--   * currently verified with Northstar Retail
--
-- Employee Two demonstrates another current company association.
-- ============================================================================

INSERT INTO workplace_associations
    (user_id, company_id, status, verified_at, ended_at)
SELECT employee.user_id, company.company_id, 'LEFT',
       TIMESTAMP('2025-02-01 09:00:00'),
       TIMESTAMP('2026-01-31 17:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Apex Logistics Ltd'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1
      FROM workplace_associations wa
      WHERE wa.user_id = employee.user_id
        AND wa.company_id = company.company_id
        AND wa.status = 'LEFT'
  );

INSERT INTO workplace_associations
    (user_id, company_id, status, verified_at)
SELECT employee.user_id, company.company_id, 'VERIFIED',
       TIMESTAMP('2026-02-10 09:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Northstar Retail Ltd'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1
      FROM workplace_associations wa
      WHERE wa.user_id = employee.user_id
        AND wa.company_id = company.company_id
        AND wa.status = 'VERIFIED'
  );

INSERT INTO workplace_associations
    (user_id, company_id, status, verified_at)
SELECT employee.user_id, company.company_id, 'VERIFIED',
       TIMESTAMP('2026-03-15 09:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Greenfield Technologies Ltd'
WHERE employee.cognito_sub = 'dev-employee-002'
  AND NOT EXISTS (
      SELECT 1
      FROM workplace_associations wa
      WHERE wa.user_id = employee.user_id
        AND wa.company_id = company.company_id
        AND wa.status = 'VERIFIED'
  );

-- ============================================================================
-- 5. SAMPLE REVIEWS
-- These are deliberately varied so the API, moderation worker and Admin UI can
-- be tested against different moderation states.
--
-- They are inserted as PENDING_ANALYSIS so the Worker Lambda can process them.
-- ============================================================================

-- Normal review: expected to produce few/no moderation signals.
INSERT INTO reviews
    (user_id, company_id, workplace_association_id, rating,
     review_title, review_text, moderation_status)
SELECT
    employee.user_id,
    company.company_id,
    wa.association_id,
    4,
    'Generally positive workplace',
    'The team was supportive and the workload was usually manageable. Communication could improve during busy periods.',
    'PENDING_ANALYSIS'
FROM user_profiles employee
JOIN companies company ON company.name = 'Northstar Retail Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1 FROM reviews r
      WHERE r.user_id = employee.user_id
        AND r.review_title = 'Generally positive workplace'
  );

-- Privacy test: synthetic email should trigger the PII email rule.
INSERT INTO reviews
    (user_id, company_id, workplace_association_id, rating,
     review_title, review_text, moderation_status)
SELECT
    employee.user_id,
    company.company_id,
    wa.association_id,
    2,
    'Communication concern',
    'I was repeatedly contacted outside working hours. A contact address included in the discussion was test.manager@example.com.',
    'PENDING_ANALYSIS'
FROM user_profiles employee
JOIN companies company ON company.name = 'Northstar Retail Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1 FROM reviews r
      WHERE r.user_id = employee.user_id
        AND r.review_title = 'Communication concern'
  );

-- Spam-pattern test: URL/repetition/punctuation signals without real external data.
INSERT INTO reviews
    (user_id, company_id, workplace_association_id, rating,
     review_title, review_text, moderation_status)
SELECT
    employee.user_id,
    company.company_id,
    wa.association_id,
    3,
    'Test spam-pattern review',
    'Please check https://example.com !!!!!!!!!! aaaaaaaaaaaa',
    'PENDING_ANALYSIS'
FROM user_profiles employee
JOIN companies company ON company.name = 'Greenfield Technologies Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-002'
  AND NOT EXISTS (
      SELECT 1 FROM reviews r
      WHERE r.user_id = employee.user_id
        AND r.review_title = 'Test spam-pattern review'
  );

-- ============================================================================
-- 6. WELLBEING CHECK-INS
-- Multiple records provide useful data for the future employer analytics view.
-- Scale: 1-5 as enforced by V001.
-- ============================================================================

INSERT INTO wellbeing_checkins
    (user_id, company_id, workplace_association_id,
     workload, stress, shift_pressure, work_life_balance, submitted_at)
SELECT employee.user_id, company.company_id, wa.association_id,
       3, 2, 3, 4, TIMESTAMP('2026-09-01 18:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Northstar Retail Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1 FROM wellbeing_checkins w
      WHERE w.user_id = employee.user_id
        AND w.company_id = company.company_id
        AND w.submitted_at = TIMESTAMP('2026-09-01 18:00:00')
  );

INSERT INTO wellbeing_checkins
    (user_id, company_id, workplace_association_id,
     workload, stress, shift_pressure, work_life_balance, submitted_at)
SELECT employee.user_id, company.company_id, wa.association_id,
       4, 4, 4, 2, TIMESTAMP('2026-09-15 18:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Northstar Retail Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-001'
  AND NOT EXISTS (
      SELECT 1 FROM wellbeing_checkins w
      WHERE w.user_id = employee.user_id
        AND w.company_id = company.company_id
        AND w.submitted_at = TIMESTAMP('2026-09-15 18:00:00')
  );

INSERT INTO wellbeing_checkins
    (user_id, company_id, workplace_association_id,
     workload, stress, shift_pressure, work_life_balance, submitted_at)
SELECT employee.user_id, company.company_id, wa.association_id,
       2, 2, 2, 4, TIMESTAMP('2026-09-20 18:00:00')
FROM user_profiles employee
JOIN companies company ON company.name = 'Greenfield Technologies Ltd'
JOIN workplace_associations wa
  ON wa.user_id = employee.user_id
 AND wa.company_id = company.company_id
 AND wa.status = 'VERIFIED'
WHERE employee.cognito_sub = 'dev-employee-002'
  AND NOT EXISTS (
      SELECT 1 FROM wellbeing_checkins w
      WHERE w.user_id = employee.user_id
        AND w.company_id = company.company_id
        AND w.submitted_at = TIMESTAMP('2026-09-20 18:00:00')
  );

COMMIT;

-- ============================================================================
-- QUICK DEVELOPMENT CHECKS
-- ============================================================================

SELECT 'user_profiles' AS table_name, COUNT(*) AS row_count FROM user_profiles
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'workplace_associations', COUNT(*) FROM workplace_associations
UNION ALL
SELECT 'employer_company_access', COUNT(*) FROM employer_company_access
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL
SELECT 'wellbeing_checkins', COUNT(*) FROM wellbeing_checkins
UNION ALL
SELECT 'moderation_rules', COUNT(*) FROM moderation_rules;

