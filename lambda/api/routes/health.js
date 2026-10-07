'use strict';

const {
  response
} = require('../utils/response');


// =============================================================================
// GET /health
// =============================================================================

async function handleHealth() {

  /*
   * Deliberately does NOT connect to RDS.
   *
   * This endpoint proves that API Gateway and the API Lambda
   * are running successfully.
   */

  return response(200, {

    success: true,

    service: 'FairWork Pulse API',

    status: 'healthy',

    timestamp: new Date().toISOString()

  });

}


module.exports = {
  handleHealth
};
