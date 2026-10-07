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
// USER PROFILE DATABASE LOGIC
// =============================================================================

async function getOrCreateUserProfile(
  connection,
  cognitoSub
) {

  /*
   * Find an existing application profile linked to this
   * Cognito identity.
   */

  const [existingRows] =
    await connection.execute(

      `
        SELECT
          user_id,
          cognito_sub,
          display_name,
          account_status,
          created_at,
          updated_at

        FROM user_profiles

        WHERE cognito_sub = ?

        LIMIT 1
      `,

      [cognitoSub]

    );


  if (existingRows.length > 0) {

    return existingRows[0];

  }


  /*
   * No profile exists yet.
   *
   * display_name is nullable and account_status defaults
   * to ACTIVE, therefore only cognito_sub is required.
   */

  try {

    await connection.execute(

      `
        INSERT INTO user_profiles (
          cognito_sub
        )
        VALUES (?)
      `,

      [cognitoSub]

    );

  } catch (error) {

    /*
     * Two simultaneous first requests could attempt to create
     * the same user.
     *
     * The UNIQUE constraint on cognito_sub protects against this.
     */

    if (error.code !== 'ER_DUP_ENTRY') {

      throw error;

    }

  }


  const [createdRows] =
    await connection.execute(

      `
        SELECT
          user_id,
          cognito_sub,
          display_name,
          account_status,
          created_at,
          updated_at

        FROM user_profiles

        WHERE cognito_sub = ?

        LIMIT 1
      `,

      [cognitoSub]

    );


  if (createdRows.length === 0) {

    throw new Error(
      'Unable to create or retrieve user profile.'
    );

  }


  return createdRows[0];

}


// =============================================================================
// GET /profile
// =============================================================================

async function handleGetProfile(event) {

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

    connection =
      await getDatabaseConnection();


    const profile =
      await getOrCreateUserProfile(

        connection,

        authenticatedUser.cognitoSub

      );


    /*
     * cognito_sub is intentionally not exposed to the frontend.
     */

    return response(200, {

      success: true,

      profile: {

        userId:
          profile.user_id,

        displayName:
          profile.display_name,

        accountStatus:
          profile.account_status,

        email:
          authenticatedUser.email,

        groups:
          authenticatedUser.groups,

        createdAt:
          profile.created_at,

        updatedAt:
          profile.updated_at

      }

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }

}


module.exports = {
  handleGetProfile,
  getOrCreateUserProfile
};
