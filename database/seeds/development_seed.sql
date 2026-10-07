-- ============================================================================
-- FairWork Pulse
-- development_seed.sql
-- Development/demo data for the FairWork Pulse MySQL database.
--
-- IMPORTANT
-- * Run migrations before this file.
-- * DEVELOPMENT / DEMONSTRATION USE ONLY.
-- * Verification codes are intentionally NOT seeded because production codes
--   should be generated securely and stored only as hashes.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

-- ============================================================================
-- 1. USER PROFILES
-- ============================================================================

INSERT INTO user_profiles (cognito_sub, display_name, account_status)
VALUES
    ('dev-employee-001', 'Demo Employee One', 'ACTIVE'),
    ('dev-employee-002', 'Demo Employee Two', 'ACTIVE'),

    -- Real Cognito EMPLOYER test account
    ('541894e8-60c1-706a-72ba-2da5a9d022bc', 'Demo Employer One', 'ACTIVE'),

    ('dev-employer-002', 'Demo Employer Two', 'ACTIVE'),
    ('dev-admin-001',    'Demo Administrator', 'ACTIVE')

ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    account_status = VALUES(account_status);


-- ============================================================================
-- 2. COMPANIES
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
-- ============================================================================

INSERT INTO employer_company_access
    (user_id, company_id, status, granted_by)

SELECT
    employer.user_id,
    company.company_id,
    'ACTIVE',
    admin_user.user_id

FROM user_profiles employer

JOIN companies company
    ON company.name = 'Northstar Retail Ltd'

JOIN user_profiles admin_user
    ON admin_user.cognito_sub = 'dev-admin-001'

WHERE employer.cognito_sub =
    '541894e8-60c1-706a-72ba-2da5a9d022bc'

ON DUPLICATE KEY UPDATE
    status = 'ACTIVE',
    granted_by = VALUES(granted_by),
    revoked_at = NULL;


INSERT INTO employer_company_access
    (user_id, company_id, status, granted_by)

SELECT
    employer.user_id,
    company.company_id,
    'ACTIVE',
    admin_user.user_id

FROM user_profiles employer

JOIN companies company
    ON company.name = 'Greenfield Technologies Ltd'

JOIN user_profiles admin_user
    ON admin_user.cognito_sub = 'dev-admin-001'

WHERE employer.cognito_sub = 'dev-employer-002'

ON DUPLICATE KEY UPDATE
    status = 'ACTIVE',
    granted_by = VALUES(granted_by),
    revoked_at = NULL;
