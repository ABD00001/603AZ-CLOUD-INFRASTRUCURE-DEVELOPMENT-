'use strict';

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

      message: 'Authentication is required.'

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
    // We deliberately identify the user using cognito_sub.
    //
    // We DO NOT accept userId from the request because a user must never
    // be able to request another employee's workplace associations.
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
    // 4. Do not allow suspended/deactivated accounts to use this feature
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
    //
    // Join companies so the frontend receives useful company information
    // without needing another API request for every association.
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


module.exports = {
  handleGetWorkplaceAssociations
};
