
'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda Entry Point
===============================================================================

 Purpose:
   Receives requests from API Gateway and routes them to the appropriate
   FairWork Pulse API handler.

 Current routes:

   GET  /health
   GET  /profile
   GET  /companies
   GET  /companies/{companyId}

   GET  /workplace-associations
   POST /workplace-associations/verify

   POST /companies/{companyId}/verification-codes

   POST /companies/{companyId}/reviews
   GET  /companies/{companyId}/reviews

 Security:
   - Authentication and authorization are enforced by API Gateway,
     Cognito and the individual route handlers.
   - Sensitive database and AWS errors are not returned to clients.
   - Employee identity must never be exposed through public review APIs.

===============================================================================
*/


// =============================================================================
// HEALTH ROUTES
// =============================================================================

const {
  handleHealth
} = require('./routes/health');


// =============================================================================
// USER PROFILE ROUTES
// =============================================================================

const {
  handleGetProfile
} = require('./routes/profile');


// =============================================================================
// COMPANY ROUTES
// =============================================================================

const {
  handleGetCompanies,
  handleGetCompany
} = require('./routes/companies');


// =============================================================================
// WORKPLACE ASSOCIATION ROUTES
// =============================================================================

const {
  handleGetWorkplaceAssociations,
  handleVerifyWorkplaceAssociation
} = require('./routes/workplace');


// =============================================================================
// EMPLOYER VERIFICATION CODE ROUTES
// =============================================================================

const {
  handleGenerateVerificationCodes
} = require('./routes/verificationCodes');


// =============================================================================
// WORKPLACE REVIEW ROUTES
// =============================================================================

const {
  handleCreateReview,
  handleGetPublishedReviews
} = require('./routes/reviews');


// =============================================================================
// RESPONSE UTILITY
// =============================================================================

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
    // POST /workplace-associations/verify
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/workplace-associations/verify'
    ) {

      return await handleVerifyWorkplaceAssociation(event);

    }


    // ------------------------------------------------------------------------
    // POST /companies/{companyId}/verification-codes
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/companies/{companyId}/verification-codes'
    ) {

      return await handleGenerateVerificationCodes(event);

    }


    // ------------------------------------------------------------------------
    // POST /companies/{companyId}/reviews
    //
    // Allows an authenticated, verified employee to submit a workplace
    // review for a company with which they have a verified association.
    //
    // The review handler must:
    //   - Validate the employee's identity and permissions.
    //   - Validate review input.
    //   - Save the review as PENDING_ANALYSIS.
    //   - Submit the review for asynchronous moderation.
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/companies/{companyId}/reviews'
    ) {

      return await handleCreateReview(event);

    }


    // ------------------------------------------------------------------------
    // GET /companies/{companyId}/reviews
    //
    // Retrieves published workplace reviews for a company.
    //
    // Only reviews with the following moderation statuses should appear:
    //
    //   CLEAN
    //   HUMAN_APPROVED
    //
    // Reviewer identity and internal moderation details must not be
    // exposed in the response.
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/companies/{companyId}/reviews'
    ) {

      return await handleGetPublishedReviews(event);

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
