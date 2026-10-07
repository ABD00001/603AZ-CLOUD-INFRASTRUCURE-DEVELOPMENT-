'use strict';

const crypto = require('crypto');

const {
  getDatabaseConnection
} = require('../services/database');

const {
  getAuthenticatedUser
} = require('../services/auth');

const {
  response
} = require('../utils/response');


// =============================================================================
// HELPERS
// =============================================================================

function normaliseVerificationCode(value) {

  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toUpperCase();

}


function isValidVerificationCodeFormat(code) {

  /*
   * FairWork Pulse verification code format:
   *
   * FW-XXXX-XXXX
   */

  return /^FW-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);

}


function hashVerificationCode(code) {

  return crypto
    .createHash('sha256')
    .update(code, 'utf8')
    .digest('hex');

}


function parseRequestBody(event) {

  if (
    !event ||
    event.body === undefined ||
    event.body === null
  ) {

    return {};

  }


  if (
    typeof event.body === 'object' &&
    !Buffer.isBuffer(event.body)
  ) {

    return event.body;

  }


  if (typeof event.body !== 'string') {

    return {};

  }


  if (event.body.trim() === '') {

    return {};

  }


  return JSON.parse(event.body);

}


// =============================================================================
// GET /workplace-associations
// =============================================================================
//
// Returns workplace associations belonging ONLY to the currently
// authenticated Cognito user.
//
// The client does not supply a userId.
// The user's identity is derived from the Cognito JWT.
//
// =============================================================================

async function handleGetWorkplaceAssociations(event) {

  // --------------------------------------------------------------------------
  // 1. Get authenticated Cognito identity
  // --------------------------------------------------------------------------

  const authenticatedUser =
    getAuthenticatedUser(event);


  if (!authenticatedUser) {

    return response(401, {

      success: false,

      message:
        'Authentication is required.'

    });

  }


  let connection;


  try {

    // ------------------------------------------------------------------------
    // 2. Connect to FairWork Pulse RDS
    // ------------------------------------------------------------------------

    connection =
      await getDatabaseConnection();


    // ------------------------------------------------------------------------
    // 3. Find the FairWork Pulse user profile
    // ------------------------------------------------------------------------
    //
    // The user is identified from cognito_sub.
    //
    // userId is deliberately NOT accepted from the request because a user
    // must never be able to request another employee's workplace associations.
    // ------------------------------------------------------------------------

    const [userRows] =
      await connection.execute(

        `
          SELECT
            user_id,
            account_status

          FROM user_profiles

          WHERE cognito_sub = ?

          LIMIT 1
        `,

        [
          authenticatedUser.cognitoSub
        ]

      );


    if (userRows.length === 0) {

      return response(404, {

        success: false,

        message:
          'User profile was not found.'

      });

    }


    const user =
      userRows[0];


    // ------------------------------------------------------------------------
    // 4. Do not allow suspended/deactivated accounts
    // ------------------------------------------------------------------------

    if (user.account_status !== 'ACTIVE') {

      return response(403, {

        success: false,

        message:
          'Your account is not active.'

      });

    }


    // ------------------------------------------------------------------------
    // 5. Retrieve ONLY this user's workplace associations
    // ------------------------------------------------------------------------

    const [rows] =
      await connection.execute(

        `
          SELECT
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
            wa.association_id DESC
        `,

        [
          user.user_id
        ]

      );


    // ------------------------------------------------------------------------
    // 6. Convert database naming into clean API naming
    // ------------------------------------------------------------------------

    const associations =
      rows.map(association => ({

        associationId:
          association.association_id,

        companyId:
          association.company_id,

        companyName:
          association.company_name,

        industry:
          association.industry,

        location:
          association.location,

        status:
          association.status,

        verifiedAt:
          association.verified_at,

        expiresAt:
          association.expires_at,

        endedAt:
          association.ended_at,

        createdAt:
          association.created_at,

        updatedAt:
          association.updated_at

      }));


    // ------------------------------------------------------------------------
    // 7. Return associations
    // ------------------------------------------------------------------------

    return response(200, {

      success: true,

      count:
        associations.length,

      associations

    });


  } finally {

    // ------------------------------------------------------------------------
    // Always close the database connection
    // ------------------------------------------------------------------------

    if (connection) {

      await connection.end();

    }

  }

}


// =============================================================================
// POST /workplace-associations/verify
// =============================================================================
//
// Allows an authenticated EMPLOYEE to redeem a one-time workplace
// verification code.
//
// The employee supplies ONLY the verification code.
//
// The employee identity comes from the Cognito JWT.
// The company identity comes from the verification code.
//
// The client therefore cannot choose either userId or companyId.
//
// Redemption and workplace-association creation happen in one database
// transaction.
//
// =============================================================================

async function handleVerifyWorkplaceAssociation(event) {

  // --------------------------------------------------------------------------
  // 1. Authenticate Cognito user
  // --------------------------------------------------------------------------

  const authenticatedUser =
    getAuthenticatedUser(event);


  if (!authenticatedUser) {

    return response(401, {

      success: false,

      message:
        'Authentication is required.'

    });

  }


  // --------------------------------------------------------------------------
  // 2. Only EMPLOYEE accounts may redeem verification codes
  // --------------------------------------------------------------------------
  //
  // auth.js already converts the Cognito "cognito:groups" claim into:
  //
  // authenticatedUser.groups
  //
  // Therefore no separate hasGroup() helper is required.
  // --------------------------------------------------------------------------

  if (
    !Array.isArray(authenticatedUser.groups) ||
    !authenticatedUser.groups.includes('EMPLOYEE')
  ) {

    return response(403, {

      success: false,

      message:
        'Employee access is required.'

    });

  }


  // --------------------------------------------------------------------------
  // 3. Parse request body
  // --------------------------------------------------------------------------

  let body;


  try {

    body =
      parseRequestBody(event);

  } catch (error) {

    return response(400, {

      success: false,

      message:
        'Request body must contain valid JSON.'

    });

  }


  const code =
    normaliseVerificationCode(body.code);


  if (!code) {

    return response(400, {

      success: false,

      message:
        'Verification code is required.'

    });

  }


  if (!isValidVerificationCodeFormat(code)) {

    return response(400, {

      success: false,

      message:
        'Verification code format is invalid.'

    });

  }


  // --------------------------------------------------------------------------
  // 4. Hash submitted verification code
  // --------------------------------------------------------------------------
  //
  // Plaintext verification codes are not looked up directly in the database.
  // --------------------------------------------------------------------------

  const codeHash =
    hashVerificationCode(code);


  let connection;

  let transactionStarted = false;


  try {

    // ------------------------------------------------------------------------
    // 5. Connect to FairWork Pulse RDS
    // ------------------------------------------------------------------------

    connection =
      await getDatabaseConnection();


    // ------------------------------------------------------------------------
    // 6. Find authenticated FairWork Pulse profile
    // ------------------------------------------------------------------------

    const [userRows] =
      await connection.execute(

        `
          SELECT
            user_id,
            account_status

          FROM user_profiles

          WHERE cognito_sub = ?

          LIMIT 1
        `,

        [
          authenticatedUser.cognitoSub
        ]

      );


    if (userRows.length === 0) {

      return response(404, {

        success: false,

        message:
          'User profile was not found.'

      });

    }


    const user =
      userRows[0];


    if (user.account_status !== 'ACTIVE') {

      return response(403, {

        success: false,

        message:
          'Your account is not active.'

      });

    }


    // ------------------------------------------------------------------------
    // 7. Begin redemption transaction
    // ------------------------------------------------------------------------

    await connection.beginTransaction();

    transactionStarted = true;


    // ------------------------------------------------------------------------
    // 8. Find and lock verification code
    // ------------------------------------------------------------------------
    //
    // FOR UPDATE prevents two simultaneous requests from successfully
    // redeeming the same one-time verification code.
    // ------------------------------------------------------------------------

    const [codeRows] =
      await connection.execute(

        `
          SELECT
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

          FOR UPDATE
        `,

        [
          codeHash
        ]

      );


    // ------------------------------------------------------------------------
    // 9. Invalid code
    // ------------------------------------------------------------------------

    if (codeRows.length === 0) {

      await connection.rollback();

      transactionStarted = false;


      return response(400, {

        success: false,

        message:
          'Verification code is invalid.'

      });

    }


    const verificationCode =
      codeRows[0];


    // ------------------------------------------------------------------------
    // 10. Validate code status
    // ------------------------------------------------------------------------

    if (verificationCode.status !== 'UNUSED') {

      await connection.rollback();

      transactionStarted = false;


      if (verificationCode.status === 'USED') {

        return response(409, {

          success: false,

          message:
            'Verification code has already been used.'

        });

      }


      if (verificationCode.status === 'REVOKED') {

        return response(400, {

          success: false,

          message:
            'Verification code is no longer valid.'

        });

      }


      if (verificationCode.status === 'EXPIRED') {

        return response(400, {

          success: false,

          message:
            'Verification code has expired.'

        });

      }


      return response(400, {

        success: false,

        message:
          'Verification code is not available for use.'

      });

    }


    // ------------------------------------------------------------------------
    // 11. Validate code expiry
    // ------------------------------------------------------------------------

    const expiresAt =
      new Date(verificationCode.expires_at);


    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {

      /*
       * Persist EXPIRED status.
       */

      await connection.execute(

        `
          UPDATE verification_codes

          SET
            status = 'EXPIRED'

          WHERE code_id = ?
        `,

        [
          verificationCode.code_id
        ]

      );


      await connection.commit();

      transactionStarted = false;


      return response(400, {

        success: false,

        message:
          'Verification code has expired.'

      });

    }


    // ------------------------------------------------------------------------
    // 12. Company must still be active
    // ------------------------------------------------------------------------

    if (verificationCode.company_status !== 'ACTIVE') {

      await connection.rollback();

      transactionStarted = false;


      return response(400, {

        success: false,

        message:
          'This workplace is not currently available for verification.'

      });

    }


    // ------------------------------------------------------------------------
    // 13. Check whether employee is already verified with this company
    // ------------------------------------------------------------------------
    //
    // A new code is NOT consumed if the employee already has an active
    // verified association with the company.
    // ------------------------------------------------------------------------

    const [existingRows] =
      await connection.execute(

        `
          SELECT
            association_id,
            status,
            verified_at,
            expires_at,
            ended_at,
            created_at,
            updated_at

          FROM workplace_associations

          WHERE user_id = ?
            AND company_id = ?
            AND status = 'VERIFIED'

          ORDER BY
            association_id DESC

          LIMIT 1

          FOR UPDATE
        `,

        [
          user.user_id,
          verificationCode.company_id
        ]

      );


    if (existingRows.length > 0) {

      const existing =
        existingRows[0];


      await connection.rollback();

      transactionStarted = false;


      return response(409, {

        success: false,

        message:
          'You already have a verified workplace association with this company.',

        association: {

          associationId:
            existing.association_id,

          companyId:
            verificationCode.company_id,

          companyName:
            verificationCode.company_name,

          industry:
            verificationCode.industry,

          location:
            verificationCode.location,

          status:
            existing.status,

          verifiedAt:
            existing.verified_at,

          expiresAt:
            existing.expires_at,

          endedAt:
            existing.ended_at,

          createdAt:
            existing.created_at,

          updatedAt:
            existing.updated_at

        }

      });

    }


    // ------------------------------------------------------------------------
    // 14. Create workplace association
    // ------------------------------------------------------------------------
    //
    // verification_codes.expires_at controls how long the CODE may be
    // redeemed.
    //
    // It does not automatically determine when the workplace association
    // itself expires.
    // ------------------------------------------------------------------------

    const [associationResult] =
      await connection.execute(

        `
          INSERT INTO workplace_associations
          (
            user_id,
            company_id,
            status,
            verified_at,
            expires_at,
            ended_at
          )

          VALUES
          (
            ?,
            ?,
            'VERIFIED',
            CURRENT_TIMESTAMP,
            NULL,
            NULL
          )
        `,

        [
          user.user_id,
          verificationCode.company_id
        ]

      );


    const associationId =
      associationResult.insertId;


    // ------------------------------------------------------------------------
    // 15. Mark verification code as USED
    // ------------------------------------------------------------------------

    const [codeUpdateResult] =
      await connection.execute(

        `
          UPDATE verification_codes

          SET
            status = 'USED',
            used_by_user_id = ?,
            used_at = CURRENT_TIMESTAMP

          WHERE code_id = ?
            AND status = 'UNUSED'
        `,

        [
          user.user_id,
          verificationCode.code_id
        ]

      );


    if (codeUpdateResult.affectedRows !== 1) {

      throw new Error(
        'Verification code could not be marked as used.'
      );

    }


    // ------------------------------------------------------------------------
    // 16. Read newly created workplace association
    // ------------------------------------------------------------------------

    const [associationRows] =
      await connection.execute(

        `
          SELECT
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

          LIMIT 1
        `,

        [
          associationId
        ]

      );


    if (associationRows.length === 0) {

      throw new Error(
        'Created workplace association could not be retrieved.'
      );

    }


    const association =
      associationRows[0];


    // ------------------------------------------------------------------------
    // 17. Commit code redemption + workplace association atomically
    // ------------------------------------------------------------------------

    await connection.commit();

    transactionStarted = false;


    // ------------------------------------------------------------------------
    // 18. Return verified workplace
    // ------------------------------------------------------------------------

    return response(201, {

      success: true,

      message:
        'Workplace association verified successfully.',

      association: {

        associationId:
          association.association_id,

        companyId:
          association.company_id,

        companyName:
          association.company_name,

        industry:
          association.industry,

        location:
          association.location,

        status:
          association.status,

        verifiedAt:
          association.verified_at,

        expiresAt:
          association.expires_at,

        endedAt:
          association.ended_at,

        createdAt:
          association.created_at,

        updatedAt:
          association.updated_at

      }

    });


  } catch (error) {

    // ------------------------------------------------------------------------
    // Roll back unfinished transaction
    // ------------------------------------------------------------------------

    if (
      connection &&
      transactionStarted
    ) {

      try {

        await connection.rollback();

      } catch (rollbackError) {

        console.error(
          'Workplace verification rollback failed:',
          {
            name:
              rollbackError.name,

            code:
              rollbackError.code,

            message:
              rollbackError.message
          }
        );

      }

    }


    /*
     * Re-throw the original error.
     *
     * index.js logs the details to CloudWatch and returns the generic
     * internal-server-error response to the API caller.
     */

    throw error;


  } finally {

    // ------------------------------------------------------------------------
    // Always close database connection
    // ------------------------------------------------------------------------

    if (connection) {

      await connection.end();

    }

  }

}


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {

  handleGetWorkplaceAssociations,

  handleVerifyWorkplaceAssociation

};
