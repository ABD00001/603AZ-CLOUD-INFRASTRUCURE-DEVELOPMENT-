
'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda Entry Point
===============================================================================

 Purpose:
   Receives requests from API Gateway and routes them to the appropriate
   FairWork Pulse API handler.

 Routes:

   GET    /health
   GET    /profile

   GET    /companies
   GET    /companies/{companyId}

   GET    /workplace-associations
   POST   /workplace-associations/verify

   POST   /companies/{companyId}/verification-codes

   POST   /companies/{companyId}/reviews
   GET    /companies/{companyId}/reviews

   GET    /admin/reviews/flagged
   POST   /admin/reviews/{reviewId}/approve
   POST   /admin/reviews/{reviewId}/reject

   POST   /admin/companies
   PATCH  /admin/companies/{companyId}
   DELETE /admin/companies/{companyId}

 Security:
   - Authentication and authorization are enforced by API Gateway,
     Cognito and the individual route handlers.
   - Admin operations require Cognito ADMIN group membership.
   - Sensitive database and AWS errors are not returned to clients.
   - Employee identity must never be exposed through public review APIs.
   - Company deletion is implemented as soft deletion.

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
// PUBLIC COMPANY ROUTES
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
// EMPLOYEE REVIEW HISTORY
// =============================================================================

const { handleGetEmployeeReviews } = require('./routes/employeeReviews');


// =============================================================================
// EMPLOYEE WELLBEING CHECK-IN
// =============================================================================

const { handleCreateWellbeingCheckin } = require('./routes/wellbeing');
const { handleGetWellbeingInsights } = require('./routes/wellbeingInsights');


// =============================================================================
// ADMIN MODERATION ROUTES
// =============================================================================

const {
  handleGetFlaggedReviews,
  handleApproveReview,
  handleRejectReview
} = require('./routes/adminModeration');


// =============================================================================
// ADMIN COMPANY MANAGEMENT ROUTES
// =============================================================================

const {
  handleCreateCompany,
  handleUpdateCompany,
  handleDeleteCompany
} = require('./routes/adminCompanies');


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
    JSON.stringify({ method, path })
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
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/companies/{companyId}/reviews'
    ) {
      return await handleCreateReview(event);
    }


    // ------------------------------------------------------------------------
    // GET /companies/{companyId}/reviews
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/companies/{companyId}/reviews'
    ) {
      return await handleGetPublishedReviews(event);
    }


    // ------------------------------------------------------------------------
    // GET /employee/reviews
    // ------------------------------------------------------------------------

    if (method === 'GET' && path === '/employee/reviews') {
      return await handleGetEmployeeReviews(event);
    }


    // ------------------------------------------------------------------------
    // POST /employee/wellbeing/checkins
    // ------------------------------------------------------------------------

    if (method === 'POST' && path === '/employee/wellbeing/checkins') {
      return await handleCreateWellbeingCheckin(event);
    }


    // ------------------------------------------------------------------------
    // GET /employee/wellbeing/insights
    if (method === 'GET' && path === '/employee/wellbeing/insights') {
      return await handleGetWellbeingInsights(event);
    }

    // ------------------------------------------------------------------------
    // GET /admin/reviews/flagged
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/admin/reviews/flagged'
    ) {
      return await handleGetFlaggedReviews(event);
    }


    // ------------------------------------------------------------------------
    // POST /admin/reviews/{reviewId}/approve
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/admin/reviews/{reviewId}/approve'
    ) {
      return await handleApproveReview(event);
    }


    // ------------------------------------------------------------------------
    // POST /admin/reviews/{reviewId}/reject
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/admin/reviews/{reviewId}/reject'
    ) {
      return await handleRejectReview(event);
    }


    // ------------------------------------------------------------------------
    // POST /admin/companies
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/admin/companies'
    ) {
      return await handleCreateCompany(event);
    }


    // ------------------------------------------------------------------------
    // PATCH /admin/companies/{companyId}
    // ------------------------------------------------------------------------

    if (
      method === 'PATCH' &&
      path === '/admin/companies/{companyId}'
    ) {
      return await handleUpdateCompany(event);
    }


    // ------------------------------------------------------------------------
    // DELETE /admin/companies/{companyId}
    // ------------------------------------------------------------------------

    if (
      method === 'DELETE' &&
      path === '/admin/companies/{companyId}'
    ) {
      return await handleDeleteCompany(event);
    }


    // ------------------------------------------------------------------------
    // UNKNOWN ROUTE
    // ------------------------------------------------------------------------

    return response(404, {
      success: false,
      message: 'Route not found.'
    });

  } catch (error) {

    console.error('FairWork API error:', {
      name: error.name,
      code: error.code,
      message: error.message
    });

    return response(500, {
      success: false,
      message: 'An internal server error occurred.'
    });

  }

};
