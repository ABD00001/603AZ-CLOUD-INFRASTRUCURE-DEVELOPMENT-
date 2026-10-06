'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda
===============================================================================

 Purpose:
   Handles the first production API endpoints for FairWork Pulse.

 Current routes:

   GET /health
   GET /profile
   GET /companies
   GET /companies/{companyId}

 Authentication:
   API Gateway + Amazon Cognito protects all routes except /health.

 Database:
   Amazon RDS MySQL.

 Identity model:
   Cognito authenticates the user.
   Cognito's unique "sub" claim is linked to user_profiles.cognito_sub.

===============================================================================
*/

const mysql = require('mysql2/promise');

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');


// =============================================================================
// ENVIRONMENT
// =============================================================================

const REGION = process.env.AWS_REGION || 'us-east-1';

const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_NAME = process.env.DB_NAME;
const DB_SECRET_ARN = process.env.DB_SECRET_ARN;


// =============================================================================
// AWS CLIENTS
// =============================================================================

const secretsClient = new SecretsManagerClient({
  region: REGION
});


// =============================================================================
// CACHED DATABASE SECRET
// =============================================================================

let cachedSecret = null;


// =============================================================================
// RESPONSE HELPER
// =============================================================================

function response(statusCode, body) {

  return {
    statusCode,

    headers: {
      'Content-Type': 'application/json'
    },

    body: JSON.stringify(body)
  };
}


// =============================================================================
// DATABASE SECRET
// =============================================================================

async function getDatabaseSecret() {

  if (cachedSecret) {
    return cachedSecret;
  }

  if (!DB_SECRET_ARN) {
    throw new Error('DB_SECRET_ARN environment variable is missing.');
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: DB_SECRET_ARN
    })
  );

  if (!result.SecretString) {
    throw new Error('Database secret does not contain SecretString.');
  }

  const secret = JSON.parse(result.SecretString);

  if (!secret.username || !secret.password) {
    throw new Error(
      'Database secret must contain username and password.'
    );
  }

  cachedSecret = secret;

  return cachedSecret;
}


// =============================================================================
// DATABASE CONNECTION
// =============================================================================

async function getDatabaseConnection() {

  if (!DB_HOST) {
    throw new Error('DB_HOST environment variable is missing.');
  }

  if (!DB_NAME) {
    throw new Error('DB_NAME environment variable is missing.');
  }

  const secret = await getDatabaseSecret();

  return mysql.createConnection({

    host: DB_HOST,

    port: DB_PORT,

    user: secret.username,

    password: secret.password,

    database: DB_NAME,

    charset: 'utf8mb4',

    connectTimeout: 10000

  });
}


// =============================================================================
// REQUEST INFORMATION
// =============================================================================

function getHttpMethod(event) {

  return (
    event.httpMethod ||
    event.requestContext?.http?.method ||
    ''
  ).toUpperCase();
}


function getPath(event) {

  return event.resource || event.rawPath || event.path || '/';
}


// =============================================================================
// COGNITO IDENTITY
// =============================================================================

function getCognitoClaims(event) {

  /*
   * REST API Cognito Authorizer:
   *
   * event.requestContext.authorizer.claims
   */

  return event.requestContext?.authorizer?.claims || null;
}


function getAuthenticatedUser(event) {

  const claims = getCognitoClaims(event);

  if (!claims) {

    return null;

  }

  const cognitoSub = claims.sub;

  if (!cognitoSub) {

    return null;

  }

  /*
   * Cognito groups may arrive as a comma-separated string.
   *
   * We don't need groups for the first endpoints yet, but we extract
   * them now because later employee/employer/admin endpoints will use them.
   */

  const rawGroups = claims['cognito:groups'];

  let groups = [];

  if (Array.isArray(rawGroups)) {

    groups = rawGroups;

  } else if (typeof rawGroups === 'string') {

    groups = rawGroups
      .split(',')
      .map(group => group.trim())
      .filter(Boolean);

  }

  return {

    cognitoSub,

    email: claims.email || null,

    groups

  };
}


// =============================================================================
// USER PROFILE
// =============================================================================

async function getOrCreateUserProfile(connection, cognitoSub) {

  /*
   * First try to find the application user linked to the Cognito identity.
   */

  const [existingRows] = await connection.execute(

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
   * No application profile exists yet.
   *
   * V001 allows display_name to be NULL and account_status defaults
   * to ACTIVE, so only the Cognito sub is required when the profile
   * is initially created.
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
     * A duplicate can occur if two first requests for the same Cognito
     * account arrive at almost exactly the same time.
     *
     * The UNIQUE constraint on cognito_sub protects the database.
     */

    if (error.code !== 'ER_DUP_ENTRY') {

      throw error;

    }

  }


  /*
   * Read the newly created profile.
   */

  const [createdRows] = await connection.execute(

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
// ROUTE: GET /health
// =============================================================================

async function handleHealth() {

  /*
   * Deliberately does NOT connect to RDS.
   *
   * /health only proves that API Gateway and the API Lambda are running.
   */

  return response(200, {

    success: true,

    service: 'FairWork Pulse API',

    status: 'healthy',

    timestamp: new Date().toISOString()

  });
}


// =============================================================================
// ROUTE: GET /profile
// =============================================================================

async function handleGetProfile(event) {

  const authenticatedUser = getAuthenticatedUser(event);


  if (!authenticatedUser) {

    /*
     * Normally API Gateway's Cognito Authorizer will reject this request
     * before Lambda is invoked.
     *
     * This is a second defensive check.
     */

    return response(401, {

      success: false,

      message: 'Authentication is required.'

    });

  }


  let connection;


  try {

    connection = await getDatabaseConnection();


    const profile = await getOrCreateUserProfile(

      connection,

      authenticatedUser.cognitoSub

    );


    /*
     * Do not return cognito_sub to the frontend unnecessarily.
     */

    return response(200, {

      success: true,

      profile: {

        userId: profile.user_id,

        displayName: profile.display_name,

        accountStatus: profile.account_status,

        email: authenticatedUser.email,

        groups: authenticatedUser.groups,

        createdAt: profile.created_at,

        updatedAt: profile.updated_at

      }

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }
}


// =============================================================================
// ROUTE: GET /companies
// =============================================================================

async function handleGetCompanies() {

  let connection;


  try {

    connection = await getDatabaseConnection();


    const [rows] = await connection.execute(

      `
        SELECT
          company_id,
          name,
          industry,
          location,
          description,
          website

        FROM companies

        WHERE status = 'ACTIVE'

        ORDER BY name ASC
      `

    );


    const companies = rows.map(company => ({

      companyId: company.company_id,

      name: company.name,

      industry: company.industry,

      location: company.location,

      description: company.description,

      website: company.website

    }));


    return response(200, {

      success: true,

      count: companies.length,

      companies

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }
}


// =============================================================================
// ROUTE: GET /companies/{companyId}
// =============================================================================

async function handleGetCompany(event) {

  const rawCompanyId = event.pathParameters?.companyId;


  /*
   * company_id is BIGINT UNSIGNED.
   *
   * Validate the path parameter before sending it to MySQL.
   */

  if (
    !rawCompanyId ||
    !/^[1-9]\d*$/.test(rawCompanyId)
  ) {

    return response(400, {

      success: false,

      message: 'A valid companyId is required.'

    });

  }


  let connection;


  try {

    connection = await getDatabaseConnection();


    const [rows] = await connection.execute(

      `
        SELECT
          company_id,
          name,
          industry,
          location,
          description,
          website

        FROM companies

        WHERE company_id = ?
          AND status = 'ACTIVE'

        LIMIT 1
      `,

      [rawCompanyId]

    );


    if (rows.length === 0) {

      return response(404, {

        success: false,

        message: 'Company not found.'

      });

    }


    const company = rows[0];


    return response(200, {

      success: true,

      company: {

        companyId: company.company_id,

        name: company.name,

        industry: company.industry,

        location: company.location,

        description: company.description,

        website: company.website

      }

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }
}


// =============================================================================
// MAIN HANDLER
// =============================================================================

exports.handler = async (event) => {

  console.log(
    'FairWork API request:',
    JSON.stringify({
      method: getHttpMethod(event),
      path: getPath(event)
    })
  );


  try {

    const method = getHttpMethod(event);

    const path = getPath(event);


    // ------------------------------------------------------------------------
    // GET /health
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/health'
    ) {

      return await handleHealth();

    }


    // ------------------------------------------------------------------------
    // GET /profile
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/profile'
    ) {

      return await handleGetProfile(event);

    }


    // ------------------------------------------------------------------------
    // GET /companies
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/companies'
    ) {

      return await handleGetCompanies();

    }


    // ------------------------------------------------------------------------
    // GET /companies/{companyId}
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/companies/{companyId}'
    ) {

      return await handleGetCompany(event);

    }


    // ------------------------------------------------------------------------
    // UNKNOWN ROUTE
    // ------------------------------------------------------------------------

    return response(404, {

      success: false,

      message: 'Route not found.'

    });


  } catch (error) {

    /*
     * Log detailed information to CloudWatch.
     *
     * Do NOT return database credentials, SQL details, stack traces or
     * Secrets Manager information to the API caller.
     */

    console.error(
      'FairWork API error:',
      {
        name: error.name,
        code: error.code,
        message: error.message
      }
    );


    return response(500, {

      success: false,

      message: 'An internal server error occurred.'

    });

  }

};
