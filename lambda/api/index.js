'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda Entry Point
===============================================================================

 Purpose:
   Receives requests from API Gateway and routes them to the appropriate
   FairWork Pulse API handler.

 Current routes:

   GET /health
   GET /profile
   GET /companies
   GET /companies/{companyId}
   GET /workplace-associations

===============================================================================
*/

const {
  handleHealth
} = require('./routes/health');

const {
  handleGetProfile
} = require('./routes/profile');

const {
  handleGetCompanies,
  handleGetCompany
} = require('./routes/companies');

const {
  handleGetWorkplaceAssociations
} = require('./routes/workplace');

const {
  response
} = require('./utils/response');


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

  return (
    event.resource ||
    event.rawPath ||
    event.path ||
    '/'
  );

}


// =============================================================================
// MAIN HANDLER
// =============================================================================

exports.handler = async (event) => {

  const method = getHttpMethod(event);

  const path = getPath(event);


  console.log(
    'FairWork API request:',
    JSON.stringify({
      method,
      path
    })
  );


  try {

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
    // GET /workplace-associations
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/workplace-associations'
    ) {

      return await handleGetWorkplaceAssociations(event);

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
     * Detailed error information goes to CloudWatch.
     *
     * Sensitive database or AWS information is not returned to the caller.
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
