'use strict';

const mysql = require('mysql2/promise');

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');


// =============================================================================
// ENVIRONMENT
// =============================================================================

const REGION =
  process.env.AWS_REGION ||
  'us-east-1';

const DB_HOST =
  process.env.DB_HOST;

const DB_PORT =
  Number(
    process.env.DB_PORT ||
    3306
  );

const DB_NAME =
  process.env.DB_NAME;

const DB_SECRET_ARN =
  process.env.DB_SECRET_ARN;


// =============================================================================
// AWS CLIENT
// =============================================================================

const secretsClient =
  new SecretsManagerClient({
    region: REGION
  });


// =============================================================================
// CACHED DATABASE SECRET
// =============================================================================

let cachedSecret = null;


// =============================================================================
// DATABASE SECRET
// =============================================================================

async function getDatabaseSecret() {

  if (cachedSecret) {

    return cachedSecret;

  }


  if (!DB_SECRET_ARN) {

    throw new Error(
      'DB_SECRET_ARN environment variable is missing.'
    );

  }


  const result =
    await secretsClient.send(

      new GetSecretValueCommand({

        SecretId:
          DB_SECRET_ARN

      })

    );


  if (!result.SecretString) {

    throw new Error(
      'Database secret does not contain SecretString.'
    );

  }


  const secret =
    JSON.parse(
      result.SecretString
    );


  if (
    !secret.username ||
    !secret.password
  ) {

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

    throw new Error(
      'DB_HOST environment variable is missing.'
    );

  }


  if (!DB_NAME) {

    throw new Error(
      'DB_NAME environment variable is missing.'
    );

  }


  const secret =
    await getDatabaseSecret();


  return mysql.createConnection({

    host:
      DB_HOST,

    port:
      DB_PORT,

    user:
      secret.username,

    password:
      secret.password,

    database:
      DB_NAME,

    charset:
      'utf8mb4',

    connectTimeout:
      10000

  });

}


module.exports = {
  getDatabaseConnection
};
