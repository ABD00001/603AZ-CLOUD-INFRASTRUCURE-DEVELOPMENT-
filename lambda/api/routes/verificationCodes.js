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
// CONFIGURATION
// =============================================================================

// Codes look like:
//
// FW-7KQ4-X9PM
//
// Ambiguous characters such as O/0 and I/1 are deliberately excluded.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const DEFAULT_QUANTITY = 10;
const MAX_QUANTITY = 50;

const CODE_EXPIRY_DAYS = 30;


// =============================================================================
// HELPER: CHECK COGNITO GROUP
// =============================================================================

function hasGroup(authenticatedUser, groupName) {

  const groups =
    Array.isArray(authenticatedUser.groups)
      ? authenticatedUser.groups
      : [];

  return groups.includes(groupName);
}


// =============================================================================
// HELPER: GENERATE RANDOM CODE SECTION
// =============================================================================

function generateRandomSection(length) {

  let result = '';

  for (let i = 0; i < length; i += 1) {

    const randomIndex =
      crypto.randomInt(0, CODE_ALPHABET.length);

    result += CODE_ALPHABET[randomIndex];

  }

  return result;
}


// =============================================================================
// HELPER: GENERATE VERIFICATION CODE
// =============================================================================

function generateVerificationCode() {

  return (
    `FW-${generateRandomSection(4)}-${generateRandomSection(4)}`
  );

}


// =============================================================================
// HELPER: HASH VERIFICATION CODE
// =============================================================================

function hashVerificationCode(code) {

  /*
   * Normalise before hashing.
   *
   * This means:
   *
   * fw-7kq4-x9pm
   *
   * and:
   *
   * FW-7KQ4-X9PM
   *
   * produce the same hash.
   */

  const normalisedCode =
    String(code)
      .trim()
      .toUpperCase();

  return crypto
    .createHash('sha256')
    .update(normalisedCode, 'utf8')
    .digest('hex');

}


// =============================================================================
// HELPER: PARSE REQUEST BODY
// =============================================================================

function parseRequestBody(event) {

  if (!event.body) {
    return {};
  }

  if (typeof event.body === 'object') {
    return event.body;
  }

  try {

    return JSON.parse(event.body);

  } catch {

    return null;

  }

}


// =============================================================================
// POST /companies/{companyId}/verification-codes
// =============================================================================
//
// Generates one-time workplace verification codes.
//
// EMPLOYER:
//   May generate codes only for a company for which they have ACTIVE
//   employer_company_access.
//
// ADMIN:
//   May generate codes for any ACTIVE company.
//
// SECURITY:
//   * Plaintext codes are returned only in this response.
//   * Only SHA-256 hashes are stored in RDS.
//   * The employer does not receive employee redemption information here.
//
// =============================================================================

async function handleGenerateVerificationCodes(event) {

  // --------------------------------------------------------------------------
  // 1. Authenticate Cognito user
  // --------------------------------------------------------------------------

  const authenticatedUser =
    getAuthenticatedUser(event);


  if (!authenticatedUser) {

    return response(401, {

      success: false,

      message: 'Authentication is required.'

    });

  }


  // --------------------------------------------------------------------------
  // 2. Authorise Cognito group
  // --------------------------------------------------------------------------

  const isEmployer =
    hasGroup(authenticatedUser, 'EMPLOYER');

  const isAdmin =
    hasGroup(authenticatedUser, 'ADMIN');


  if (!isEmployer && !isAdmin) {

    return response(403, {

      success: false,

      message:
        'Employer or administrator access is required.'

    });

  }


  // --------------------------------------------------------------------------
  // 3. Validate companyId
  // --------------------------------------------------------------------------

  const companyId =
    Number(event.pathParameters?.companyId);


  if (
    !Number.isInteger(companyId) ||
    companyId <= 0
  ) {

    return response(400, {

      success: false,

      message: 'A valid companyId is required.'

    });

  }


  // --------------------------------------------------------------------------
  // 4. Parse request body
  // --------------------------------------------------------------------------

  const body =
    parseRequestBody(event);


  if (body === null) {

    return response(400, {

      success: false,

      message: 'Request body must contain valid JSON.'

    });

  }


  // --------------------------------------------------------------------------
  // 5. Validate quantity
  // --------------------------------------------------------------------------

  const quantity =
    body.quantity === undefined
      ? DEFAULT_QUANTITY
      : Number(body.quantity);


  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_QUANTITY
  ) {

    return response(400, {

      success: false,

      message:
        `quantity must be between 1 and ${MAX_QUANTITY}.`

    });

  }


  let connection;


  try {

    // ------------------------------------------------------------------------
    // 6. Connect to database
    // ------------------------------------------------------------------------

    connection =
      await getDatabaseConnection();


    // ------------------------------------------------------------------------
    // 7. Find authenticated FairWork Pulse user
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
    // 8. Confirm company exists and is active
    // ------------------------------------------------------------------------

    const [companyRows] =
      await connection.execute(

        `
          SELECT
            company_id,
            name,
            status

          FROM companies

          WHERE company_id = ?

          LIMIT 1
        `,

        [
          companyId
        ]

      );


    if (companyRows.length === 0) {

      return response(404, {

        success: false,

        message: 'Company was not found.'

      });

    }


    const company =
      companyRows[0];


    if (company.status !== 'ACTIVE') {

      return response(403, {

        success: false,

        message:
          'Verification codes cannot be generated for this company.'

      });

    }


    // ------------------------------------------------------------------------
    // 9. EMPLOYER must have ACTIVE access to this exact company
    // ------------------------------------------------------------------------
    //
    // ADMIN bypasses employer_company_access because administrators may manage
    // companies across the platform.
    // ------------------------------------------------------------------------

    if (!isAdmin) {

      const [accessRows] =
        await connection.execute(

          `
            SELECT
              access_id

            FROM employer_company_access

            WHERE user_id = ?
              AND company_id = ?
              AND status = 'ACTIVE'

            LIMIT 1
          `,

          [
            user.user_id,
            companyId
          ]

        );


      if (accessRows.length === 0) {

        return response(403, {

          success: false,

          message:
            'You are not authorised to generate verification codes for this company.'

        });

      }

    }


    // ------------------------------------------------------------------------
    // 10. Calculate expiry
    // ------------------------------------------------------------------------

    const expiresAt =
      new Date(
        Date.now() +
        CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      );


    // MySQL DATETIME/TIMESTAMP-friendly UTC value.

    const expiresAtSql =
      expiresAt
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');


    // ------------------------------------------------------------------------
    // 11. Generate + store codes
    // ------------------------------------------------------------------------
    //
    // Only the hash is inserted into RDS.
    //
    // Plaintext codes exist temporarily in this Lambda invocation so they can
    // be returned once to the authorised employer/admin.
    // ------------------------------------------------------------------------

    const plaintextCodes = [];


    await connection.beginTransaction();


    try {

      for (let i = 0; i < quantity; i += 1) {

        let code;
        let codeHash;
        let inserted = false;


        /*
         * Collision probability is extremely small, but the UNIQUE constraint
         * on code_hash is still respected.
         *
         * Retry a few times in the unlikely event of a duplicate.
         */

        for (let attempt = 0; attempt < 5; attempt += 1) {

          code =
            generateVerificationCode();

          codeHash =
            hashVerificationCode(code);


          try {

            await connection.execute(

              `
                INSERT INTO verification_codes
                  (
                    company_id,
                    code_hash,
                    status,
                    created_by,
                    expires_at
                  )

                VALUES
                  (?, ?, 'UNUSED', ?, ?)
              `,

              [
                companyId,
                codeHash,
                user.user_id,
                expiresAtSql
              ]

            );


            inserted = true;

            break;


          } catch (error) {

            /*
             * MySQL error 1062 = duplicate unique value.
             *
             * A duplicate code simply causes another random code to be
             * generated.
             */

            if (error.errno !== 1062) {
              throw error;
            }

          }

        }


        if (!inserted) {

          throw new Error(
            'Unable to generate a unique verification code.'
          );

        }


        plaintextCodes.push(code);

      }


      await connection.commit();


    } catch (error) {

      await connection.rollback();

      throw error;

    }


    // ------------------------------------------------------------------------
    // 12. Return plaintext codes ONCE
    // ------------------------------------------------------------------------

    return response(201, {

      success: true,

      companyId:
        company.company_id,

      companyName:
        company.name,

      quantity:
        plaintextCodes.length,

      expiresAt:
        expiresAt.toISOString(),

      codes:
        plaintextCodes,

      message:
        'Verification codes generated successfully. Save these codes now because they will not be shown again.'

    });


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

  handleGenerateVerificationCodes,
  hashVerificationCode

};
