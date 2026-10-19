
'use strict';

// =============================================================================
// CORS
// =============================================================================

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://fairwork-pulse-frontend.s3-website-us-east-1.amazonaws.com'
];

// =============================================================================
// API RESPONSE
// =============================================================================

function response(statusCode, body, requestOrigin) {

  const headers = {
    'Content-Type': 'application/json',

    'Access-Control-Allow-Headers':
      'Content-Type,Authorization',

    'Access-Control-Allow-Methods':
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',

    'Vary': 'Origin'
  };

  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

module.exports = {
  response
};
