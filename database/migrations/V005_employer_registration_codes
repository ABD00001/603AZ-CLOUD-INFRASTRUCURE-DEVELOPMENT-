CREATE TABLE IF NOT EXISTS employer_registration_codes (
  code_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  status ENUM('UNUSED','USED','EXPIRED','REVOKED') NOT NULL DEFAULT 'UNUSED',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_by_user_id BIGINT UNSIGNED NULL,
  used_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (code_id),
  UNIQUE KEY uq_employer_registration_code_hash (code_hash),
  KEY idx_employer_registration_company_status (company_id, status, expires_at),
  CONSTRAINT fk_employer_reg_company FOREIGN KEY (company_id) REFERENCES companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_employer_reg_creator FOREIGN KEY (created_by) REFERENCES user_profiles(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_employer_reg_user FOREIGN KEY (used_by_user_id) REFERENCES user_profiles(user_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
