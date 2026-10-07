-- ============================================================================
-- FairWork Pulse
-- V003__map_employer_cognito_identity.sql
--
-- Purpose:
-- Map the existing synthetic Northstar employer profile to the real Cognito
-- EMPLOYER test account.
--
-- Cognito account:
--   iamabd3333@gmail.com
--
-- Cognito sub:
--   541894e8-60c1-706a-72ba-2da5a9d022bc
--
-- IMPORTANT:
-- We UPDATE the existing user_profiles row rather than creating another
-- employer. This preserves the existing user_id and therefore preserves
-- employer_company_access foreign-key relationships.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;


-- ============================================================================
-- 1. MAP SYNTHETIC EMPLOYER TO REAL COGNITO IDENTITY
-- ============================================================================

UPDATE user_profiles

SET
    cognito_sub = '541894e8-60c1-706a-72ba-2da5a9d022bc',
    display_name = 'Demo Employer One',
    account_status = 'ACTIVE',
    updated_at = CURRENT_TIMESTAMP

WHERE cognito_sub = 'dev-employer-001';


-- ============================================================================
-- 2. SAFETY CHECK
-- ============================================================================
--
-- The existing employer_company_access row remains connected because
-- user_profiles.user_id does not change.
-- ============================================================================

COMMIT;


-- ============================================================================
-- DEVELOPMENT VERIFICATION
-- ============================================================================

SELECT
    up.user_id,
    up.cognito_sub,
    up.display_name,
    up.account_status,
    eca.company_id,
    eca.status AS access_status,
    c.name AS company_name

FROM user_profiles up

LEFT JOIN employer_company_access eca
    ON eca.user_id = up.user_id

LEFT JOIN companies c
    ON c.company_id = eca.company_id

WHERE up.cognito_sub =
    '541894e8-60c1-706a-72ba-2da5a9d022bc';
