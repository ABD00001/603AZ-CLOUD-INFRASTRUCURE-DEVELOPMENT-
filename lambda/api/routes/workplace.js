
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

const CODE_PATTERN = /^FW-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// ============================================================================
// HELPERS
// ============================================================================

function normaliseVerificationCode(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function hashVerificationCode(code) {
  return crypto
    .createHash('sha256')
    .update(code, 'utf8')
    .digest('hex');
}

function parseRequestBody(event) {
  if (!event || event.body == null || event.body === '') {
    return {};
  }

  if (typeof event.body === 'object' &&
      !Buffer.isBuffer(event.body)) {
    return event.body;
  }

  return JSON.parse(event.body);
}

function formatAssociation(row) {
  return {
    associationId: row.association_id,
    companyId: row.company_id,
    companyName: row.company_name,
    industry: row.industry,
    location: row.location,
    status: row.status,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function assignEmployeeGroup(user, companyId, retry = false) {
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: user.cognitoSub,
        GroupName: 'EMPLOYEE'
      })
    );

    return response(200, {
      success: true,
      companyId,
      retry,
      message: 'Employee account activated. Please sign in again.'
    });

  } catch (error) {
    console.error('Employee Cognito assignment failed:', {
      name: error.name,
      code: error.code,
      message: error.message
    });

    return response(503, {
      success: false,
      registrationPending: true,
      message:
        'Workplace linked, but employee activation is pending. ' +
        'Please retry using the same verification code.'
    });
  }
}

// ============================================================================
// GET /workplace-associations
// ============================================================================

async function handleGetWorkplaceAssociations(event) {
  const authenticatedUser = getAuthenticatedUser(event);

  if (!authenticatedUser) {
    return response(401, {
      success: false,
      message: 'Authentication is required.'
    });
  }

  let connection;

  try {
    connection = await getDatabaseConnection();

    const [userRows] = await connection.execute(
      `SELECT user_id, account_status
       FROM user_profiles
       WHERE cognito_sub = ?
       LIMIT 1`,
      [authenticatedUser.cognitoSub]
    );

    if (!userRows.length) {
      return response(404, {
        success: false,
        message: 'User profile was not found.'
      });
    }

    const user = userRows[0];

    if (user.account_status !== 'ACTIVE') {
      return response(403, {
        success: false,
        message: 'Your account is not active.'
      });
    }

    const [rows] = await connection.execute(
      `SELECT
         wa.association_id,
         wa.company_id,
         c.name AS company_name,
         c.industry,
         c.location,
         wa.status,
         wa.verified_at,
         wa.expires_at,
         wa.ended_at,
         wa.created_at,
         wa.updated_at
       FROM workplace_associations wa
       INNER JOIN companies c
         ON c.company_id = wa.company_id
       WHERE wa.user_id = ?
       ORDER BY
         wa.created_at DESC,
         wa.association_id DESC`,
      [user.user_id]
    );

    return response(200, {
      success: true,
      count: rows.length,
      associations: rows.map(formatAssociation)
    });

  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ============================================================================
// POST /workplace-associations/verify
// ============================================================================

async function handleVerifyWorkplaceAssociation(event) {
  const authenticatedUser = getAuthenticatedUser(event);

  if (!authenticatedUser) {
    return response(401, {
      success: false,
      message: 'Authentication is required.'
    });
  }

  const groups = authenticatedUser.groups || [];
  const claims = event.requestContext?.authorizer?.claims || {};

  // A newly registered user must verify their email first.
  if (
    !authenticatedUser.email ||
    ![true, 'true'].includes(claims.email_verified)
  ) {
    return response(403, {
      success: false,
      message: 'Please verify your email first.'
    });
  }

  // Prevent admin/employer accounts from becoming employees.
  if (
    groups.includes('ADMIN') ||
    groups.includes('EMPLOYER')
  ) {
    return response(403, {
      success: false,
      message: 'Use a separate employee account.'
    });
  }

  if (!process.env.COGNITO_USER_POOL_ID) {
    return response(503, {
      success: false,
      message: 'Employee registration is not configured.'
    });
  }

  let body;

  try {
    body = parseRequestBody(event);
  } catch {
    return response(400, {
      success: false,
      message: 'Request body must contain valid JSON.'
    });
  }

  const code = normaliseVerificationCode(body?.code);

  if (!code) {
    return response(400, {
      success: false,
      message: 'Verification code is required.'
    });
  }

  if (!CODE_PATTERN.test(code)) {
    return response(400, {
      success: false,
      message: 'Verification code format is invalid.'
    });
  }

  const codeHash = hashVerificationCode(code);

  let connection;
  let transactionStarted = false;

  try {
    connection = await getDatabaseConnection();

    await connection.beginTransaction();
    transactionStarted = true;

    // Create a profile for a new Cognito user.
    await connection.execute(
      `INSERT INTO user_profiles (cognito_sub)
       VALUES (?)
       ON DUPLICATE KEY UPDATE
         cognito_sub = VALUES(cognito_sub)`,
      [authenticatedUser.cognitoSub]
    );

    const [userRows] = await connection.execute(
      `SELECT user_id, account_status
       FROM user_profiles
       WHERE cognito_sub = ?
       LIMIT 1
       FOR UPDATE`,
      [authenticatedUser.cognitoSub]
    );

    if (!userRows.length) {
      throw new Error('User profile could not be retrieved.');
    }

    const user = userRows[0];

    if (user.account_status !== 'ACTIVE') {
      await connection.rollback();
      transactionStarted = false;

      return response(403, {
        success: false,
        message: 'Your account is not active.'
      });
    }

    // Prevent employees from registering as employers and vice versa.
    const [employerAccess] = await connection.execute(
      `SELECT access_id
       FROM employer_company_access
       WHERE user_id = ?
       LIMIT 1`,
      [user.user_id]
    );

    if (employerAccess.length) {
      await connection.rollback();
      transactionStarted = false;

      return response(403, {
        success: false,
        message: 'This account has employer access.'
      });
    }

    // Lock the verification code to prevent simultaneous redemption.
    const [codeRows] = await connection.execute(
      `SELECT
         vc.code_id,
         vc.company_id,
         vc.status,
         vc.expires_at,
         vc.used_by_user_id,
         vc.used_at,
         c.name AS company_name,
         c.industry,
         c.location,
         c.status AS company_status
       FROM verification_codes vc
       INNER JOIN companies c
         ON c.company_id = vc.company_id
       WHERE vc.code_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [codeHash]
    );

    if (!codeRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return response(400, {
        success: false,
        message: 'Verification code is invalid.'
      });
    }

    const verificationCode = codeRows[0];

    // Retry is permitted only for the original redeemer.
    const retry =
      verificationCode.status === 'USED' &&
      verificationCode.used_by_user_id !== null &&
      Number(verificationCode.used_by_user_id) ===
        Number(user.user_id);

    if (retry) {
      const [existingRows] = await connection.execute(
        `SELECT association_id
         FROM workplace_associations
         WHERE user_id = ?
           AND company_id = ?
           AND status = 'VERIFIED'
         LIMIT 1`,
        [user.user_id, verificationCode.company_id]
      );

      await connection.rollback();
      transactionStarted = false;

      if (!existingRows.length) {
        return response(409, {
          success: false,
          message: 'No verified workplace association found for this code.'
        });
      }

      return await assignEmployeeGroup(
        authenticatedUser,
        verificationCode.company_id,
        true
      );
    }

    if (verificationCode.status !== 'UNUSED') {
      await connection.rollback();
      transactionStarted = false;

      return response(409, {
        success: false,
        message: 'Verification code has already been used or revoked.'
      });
    }

    // Validate code expiry using the database clock.
    const [expiryRows] = await connection.execute(
      `SELECT (? > UTC_TIMESTAMP()) AS is_valid`,
      [verificationCode.expires_at]
    );

    if (!Number(expiryRows[0].is_valid)) {
      await connection.execute(
        `UPDATE verification_codes
         SET status = 'EXPIRED'
         WHERE code_id = ?
           AND status = 'UNUSED'`,
        [verificationCode.code_id]
      );

      await connection.commit();
      transactionStarted = false;

      return response(410, {
        success: false,
        message: 'Verification code has expired.'
      });
    }

    if (verificationCode.company_status !== 'ACTIVE') {
      await connection.rollback();
      transactionStarted = false;

      return response(403, {
        success: false,
        message: 'This workplace is not currently available.'
      });
    }

    // Check for an existing verified association.
    const [existingRows] = await connection.execute(
      `SELECT association_id
       FROM workplace_associations
       WHERE user_id = ?
         AND company_id = ?
         AND status = 'VERIFIED'
       LIMIT 1
       FOR UPDATE`,
      [user.user_id, verificationCode.company_id]
    );

    if (existingRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return response(409, {
        success: false,
        message:
          'You already have a verified workplace association ' +
          'with this company.'
      });
    }

    // Create the employee's verified workplace association.
    const [associationResult] = await connection.execute(
      `INSERT INTO workplace_associations
         (
           user_id,
           company_id,
           status,
           verified_at,
           expires_at,
           ended_at
         )
       VALUES (?, ?, 'VERIFIED', CURRENT_TIMESTAMP, NULL, NULL)`,
      [user.user_id, verificationCode.company_id]
    );

    // Mark the one-time code as used.
    const [codeUpdateResult] = await connection.execute(
      `UPDATE verification_codes
       SET status = 'USED',
           used_by_user_id = ?,
           used_at = CURRENT_TIMESTAMP
       WHERE code_id = ?
         AND status = 'UNUSED'`,
      [user.user_id, verificationCode.code_id]
    );

    if (codeUpdateResult.affectedRows !== 1) {
      throw new Error('Verification code could not be marked as used.');
    }

    const [associationRows] = await connection.execute(
      `SELECT
         wa.association_id,
         wa.company_id,
         c.name AS company_name,
         c.industry,
         c.location,
         wa.status,
         wa.verified_at,
         wa.expires_at,
         wa.ended_at,
         wa.created_at,
         wa.updated_at
       FROM workplace_associations wa
       INNER JOIN companies c
         ON c.company_id = wa.company_id
       WHERE wa.association_id = ?
       LIMIT 1`,
      [associationResult.insertId]
    );

    if (!associationRows.length) {
      throw new Error('Created association could not be retrieved.');
    }

    const association = formatAssociation(associationRows[0]);

    // Commit RDS changes before updating Cognito.
    await connection.commit();
    transactionStarted = false;

    // Cognito is separate from RDS.
    // A failed group assignment can be retried with the same code.
    const activation = await assignEmployeeGroup(
      authenticatedUser,
      verificationCode.company_id,
      false
    );

    if (activation.statusCode !== 200) {
      return activation;
    }

    return response(201, {
      success: true,
      message: 'Workplace association verified successfully.',
      association
    });

  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Workplace rollback failed:', rollbackError);
      }
    }

    console.error('Workplace verification failed:', {
      name: error.name,
      code: error.code,
      message: error.message
    });

    throw error;

  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  handleGetWorkplaceAssociations,
  handleVerifyWorkplaceAssociation
};
