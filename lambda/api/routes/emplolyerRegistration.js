
'use strict';

const crypto = require('crypto');

const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

const cognito = new CognitoIdentityProviderClient({});

const CODE_PATTERN = /^FWP-E-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

function hashCode(code) {
  return crypto.createHash('sha256')
    .update(code.trim().toUpperCase())
    .digest('hex');
}

function parseBody(event) {
  try {
    const body = event.body
      ? typeof event.body === 'string'
        ? JSON.parse(event.body)
        : event.body
      : {};

    return body && typeof body === 'object' &&
      !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function handleRedeemEmployerCode(event) {
  const user = getAuthenticatedUser(event);

  if (!user) {
    return response(401, {
      success: false,
      message: 'Authentication required.'
    });
  }

  if (!user.email) {
    return response(403, {
      success: false,
      message: 'A verified email is required.'
    });
  }

  const claims = event.requestContext?.authorizer?.claims;

  if (claims?.email_verified !== true &&
      claims?.email_verified !== 'true') {
    return response(403, {
      success: false,
      message: 'Please verify your email first.'
    });
  }

  if (user.groups.includes('ADMIN') ||
      user.groups.includes('EMPLOYER')) {
    return response(403, {
      success: false,
      message: 'This account is not eligible for employer registration.'
    });
  }

  const body = parseBody(event);

  if (!body || typeof body.code !== 'string') {
    return response(400, {
      success: false,
      message: 'A registration code is required.'
    });
  }

  const code = body.code.trim().toUpperCase();

  if (!CODE_PATTERN.test(code)) {
    return response(400, {
      success: false,
      message: 'Invalid employer registration code format.'
    });
  }

  const userPoolId = process.env.COGNITO_USER_POOL_ID;

  if (!userPoolId) {
    return response(503, {
      success: false,
      message: 'Employer registration is not configured.'
    });
  }

  let db;
  let committed = false;
  let companyId;

  try {
    db = await getDatabaseConnection();
    await db.beginTransaction();

    // Lock the code to prevent concurrent redemption.
    const [codes] = await db.execute(
      `SELECT code_id, company_id, status,
              expires_at, used_by_user_id
       FROM employer_registration_codes
       WHERE code_hash = ?
       FOR UPDATE`,
      [hashCode(code)]
    );

    if (!codes.length) {
      await db.rollback();
      return response(400, {
        success: false,
        message: 'Invalid registration code.'
      });
    }

    const registration = codes[0];
    companyId = Number(registration.company_id);

    // Create the user profile if it does not exist.
    await db.execute(
      `INSERT INTO user_profiles (cognito_sub)
       VALUES (?)
       ON DUPLICATE KEY UPDATE
         cognito_sub = VALUES(cognito_sub)`,
      [user.cognitoSub]
    );

    const [profiles] = await db.execute(
      `SELECT user_id, account_status
       FROM user_profiles
       WHERE cognito_sub = ?
       FOR UPDATE`,
      [user.cognitoSub]
    );

    const profile = profiles[0];

    if (profile.account_status !== 'ACTIVE') {
      await db.rollback();
      return response(403, {
        success: false,
        message: 'Your account is not active.'
      });
    }

    // Permit retries only by the user who redeemed
    // this code previously.
    const retry =
      registration.status === 'USED' &&
      Number(registration.used_by_user_id) ===
        Number(profile.user_id);

    if (!retry && registration.status !== 'UNUSED') {
      await db.rollback();
      return response(409, {
        success: false,
        message: 'This code has already been used or revoked.'
      });
    }

    if (!retry) {
      const [expiry] = await db.execute(
        `SELECT (? > UTC_TIMESTAMP()) AS valid`,
        [registration.expires_at]
      );

      if (!Number(expiry[0].valid)) {
        await db.rollback();
        return response(410, {
          success: false,
          message: 'This registration code has expired.'
        });
      }
    }

    const [companies] = await db.execute(
      `SELECT company_id
       FROM companies
       WHERE company_id = ? AND status = 'ACTIVE'`,
      [companyId]
    );

    if (!companies.length) {
      await db.rollback();
      return response(403, {
        success: false,
        message: 'The company is unavailable.'
      });
    }

    // Prevent linking an employee account to an
    // employer company through this endpoint.
    const [employeeLinks] = await db.execute(
      `SELECT association_id
       FROM workplace_associations
       WHERE user_id = ?
       LIMIT 1`,
      [profile.user_id]
    );

    if (employeeLinks.length ||
        user.groups.includes('EMPLOYEE')) {
      await db.rollback();
      return response(403, {
        success: false,
        message: 'Use a separate account for employer registration.'
      });
    }

    // Prevent claiming a different company.
    const [existingAccess] = await db.execute(
      `SELECT company_id
       FROM employer_company_access
       WHERE user_id = ?`,
      [profile.user_id]
    );

    if (existingAccess.some(
      row => Number(row.company_id) !== companyId
    )) {
      await db.rollback();
      return response(409, {
        success: false,
        message: 'Account already linked to another company.'
      });
    }

    if (!retry) {
      await db.execute(
        `INSERT INTO employer_company_access
          (user_id, company_id, status, granted_by)
         VALUES (?, ?, 'ACTIVE', ?)
         ON DUPLICATE KEY UPDATE
           status = 'ACTIVE',
           revoked_at = NULL`,
        [
          profile.user_id,
          companyId,
          registration.created_by
        ]
      );

      await db.execute(
        `UPDATE employer_registration_codes
         SET status = 'USED',
             used_by_user_id = ?,
             used_at = UTC_TIMESTAMP()
         WHERE code_id = ? AND status = 'UNUSED'`,
        [profile.user_id, registration.code_id]
      );
    }

    await db.commit();
    committed = true;

  } catch (error) {
    if (db && !committed) {
      try { await db.rollback(); } catch (_) {}
    }

    console.error('Employer redemption database error:', {
      name: error.name,
      code: error.code
    });

    return response(500, {
      success: false,
      message: 'Unable to process employer registration.'
    });

  } finally {
    if (db) await db.end();
  }

  // Cognito is a separate service, so this step
  // happens after the RDS transaction.
  try {
    const result = await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: user.cognitoSub,
        GroupName: 'EMPLOYER'
      })
    );

    return response(200, {
      success: true,
      companyId,
      message: 'Employer registration completed. Please sign in again.'
    });

  } catch (error) {
    console.error('Cognito group assignment failed:', {
      name: error.name,
      code: error.code
    });

    return response(503, {
      success: false,
      registrationPending: true,
      message: 'Company linked, but account activation is pending. Please retry with the same code.'
    });
  }
}

module.exports = {
  handleRedeemEmployerCode
};
