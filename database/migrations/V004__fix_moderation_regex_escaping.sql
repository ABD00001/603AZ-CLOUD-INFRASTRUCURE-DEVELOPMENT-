-- FairWork Pulse: Repair regex backslashes consumed by MySQL SQL literal parsing.
-- Safe to rerun. Does not modify review data or moderation scores.
-- Uses CHAR(92) so behavior is independent of NO_BACKSLASH_ESCAPES.
SET NAMES utf8mb4;
START TRANSACTION;

UPDATE moderation_rules
SET pattern = CONCAT('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', CHAR(92), '.[A-Za-z]{2,}')
WHERE rule_code = 'PII_EMAIL_ADDRESS' AND pattern_type = 'REGEX';

UPDATE moderation_rules
SET pattern = CONCAT('(?:', CHAR(92), '+44', CHAR(92), 's?7', CHAR(92), 'd{3}|0?7', CHAR(92), 'd{3})[', CHAR(92), 's-]?', CHAR(92), 'd{3}[', CHAR(92), 's-]?', CHAR(92), 'd{3}')
WHERE rule_code = 'PII_UK_MOBILE' AND pattern_type = 'REGEX';

UPDATE moderation_rules
SET pattern = CONCAT(CHAR(92), 'b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}', CHAR(92), 's?', CHAR(92), 'd{2}', CHAR(92), 's?', CHAR(92), 'd{2}', CHAR(92), 's?', CHAR(92), 'd{2}', CHAR(92), 's?[A-D]', CHAR(92), 'b')
WHERE rule_code = 'PII_UK_NATIONAL_INSURANCE' AND pattern_type = 'REGEX';

UPDATE moderation_rules
SET pattern = CONCAT('(.)', CHAR(92), '1{9,}')
WHERE rule_code = 'SPAM_REPEATED_CHARACTERS' AND pattern_type = 'REGEX';

COMMIT;

-- Inspect exact stored backslashes and rule patterns after applying.
SELECT rule_code, pattern, HEX(pattern) AS pattern_hex
FROM moderation_rules
WHERE rule_code IN ('PII_EMAIL_ADDRESS','PII_UK_MOBILE','PII_UK_NATIONAL_INSURANCE','SPAM_REPEATED_CHARACTERS')
ORDER BY rule_code;
