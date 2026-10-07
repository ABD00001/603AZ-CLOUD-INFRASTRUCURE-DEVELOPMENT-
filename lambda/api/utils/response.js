'use strict';


// =============================================================================
// CORS
// =============================================================================

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  'http://localhost:3000';


// =============================================================================
// API RESPONSE
// =============================================================================

function response(
  statusCode,
  body
) {

  return {

    statusCode,

    headers: {

      'Content-Type':
        'application/json',

      'Access-Control-Allow-Origin':
        ALLOWED_ORIGIN,

      'Access-Control-Allow-Headers':
        'Content-Type,Authorization',

      'Access-Control-Allow-Methods':
        'GET,POST,PUT,PATCH,DELETE,OPTIONS'

    },

    body:
      JSON.stringify(body)

  };

}


module.exports = {
  response
};
