
'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda Entry Point
===============================================================================

 Purpose:
   Receives requests from API Gateway and routes them to the appropriate
   FairWork Pulse API handler.

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
// VERIFICATION CODE ROUTES
// =============================================================================

const {
  handleGenerateVerificationCodes
} = require('./routes/verificationCodes');

const {
  handleGenerateEmployerCodes
} = require('./routes/adminEmployerCodes');


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

const {
  handleGetEmployeeReviews
} = require('./routes/employeeReviews');


// =============================================================================
// EMPLOYEE WELLBEING ROUTES
// =============================================================================

const {
  handleCreateWellbeingCheckin
} = require('./routes/wellbeing');

const {
  handleGetWellbeingInsights
} = require('./routes/wellbeingInsights');


// =============================================================================
// EMPLOYER ROUTES
// =============================================================================

const {
  handleGetEmployerCompany
} = require('./routes/employerCompany');

const {
  handleGetEmployerReviews
} = require('./routes/employerReviews');

const {
  handleGetEmployerDashboardOverview
} = require('./routes/employerDashboardOverview');

const {
  handleGetEmployerWellbeingAnalytics
} = require('./routes/employerWellbeingAnalytics');

const {
  handleCreateEmployerResponse
} = require('./routes/employerResponses');


// =============================================================================
// ADMIN DASHBOARD ROUTES
// =============================================================================

const {
  handleGetAdminDashboardOverview
} = require('./routes/adminDashboardOverview');


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
  handleDeleteCompany,
  handleGetAdminCompanies,
  handleReactivateAdminCompany
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
// CORS CONFIGURATION
// =============================================================================

const ALLOWED_ORIGINS = new Set([

  // Local development
  'http://localhost:3000',
  'http://localhost:3001',

  // Previous S3 frontend
  'http://fairwork-pulse-frontend.s3-website-us-east-1.amazonaws.com',

  // Production AWS Amplify frontend
  'https://main.d3gj60hs80y0r0.amplifyapp.com',

  // Origin configured by CloudFormation
  ...(process.env.ALLOWED_ORIGIN
    ? [process.env.ALLOWED_ORIGIN.trim()]
    : [])

]);


// =============================================================================
// CENTRALIZED CORS RESPONSE HANDLING
// =============================================================================

function addCorsHeaders(result, event) {

  const requestOrigin =
    event.headers?.origin ||
    event.headers?.Origin ||
    '';

  // Preserve the route handler's existing response.
  const headers = {
    ...(result?.headers || {})
  };

  // Remove existing CORS origin headers.
  // The validated origin will be added below.
  for (const headerName of Object.keys(headers)) {

    if (
      headerName.toLowerCase() ===
      'access-control-allow-origin'
    ) {

      delete headers[headerName];

    }

  }

  headers['Access-Control-Allow-Headers'] =
    'Content-Type,Authorization';

  headers['Access-Control-Allow-Methods'] =
    'GET,POST,PUT,PATCH,DELETE,OPTIONS';

  headers['Vary'] = 'Origin';

  // Only approved frontend origins receive CORS permission.
  if (ALLOWED_ORIGINS.has(requestOrigin)) {

    headers['Access-Control-Allow-Origin'] =
      requestOrigin;

  }

  return {
    ...result,
    headers
  };

}


// =============================================================================
// ROUTE REQUEST
// =============================================================================

async function routeRequest(event) {

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
    // POST /admin/companies/{companyId}/employer-codes
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/admin/companies/{companyId}/employer-codes'
    ) {

      return await handleGenerateEmployerCodes(event);

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

    if (
      method === 'GET' &&
      path === '/employee/reviews'
    ) {

      return await handleGetEmployeeReviews(event);

    }


    // ------------------------------------------------------------------------
    // POST /employee/wellbeing/checkins
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/employee/wellbeing/checkins'
    ) {

      return await handleCreateWellbeingCheckin(event);

    }


    // ------------------------------------------------------------------------
    // GET /employee/wellbeing/insights
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/employee/wellbeing/insights'
    ) {

      return await handleGetWellbeingInsights(event);

    }


    // ------------------------------------------------------------------------
    // POST /employer/reviews/{reviewId}/response
    // ------------------------------------------------------------------------

    if (
      method === 'POST' &&
      path === '/employer/reviews/{reviewId}/response'
    ) {

      return await handleCreateEmployerResponse(event);

    }


    // ------------------------------------------------------------------------
    // GET /employer/dashboard/overview
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/employer/dashboard/overview'
    ) {

      return await handleGetEmployerDashboardOverview(event);

    }


    // ------------------------------------------------------------------------
    // GET /employer/analytics/wellbeing
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/employer/analytics/wellbeing'
    ) {

      return await handleGetEmployerWellbeingAnalytics(event);

    }


    // ------------------------------------------------------------------------
    // GET /employer/reviews
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/employer/reviews'
    ) {

      return await handleGetEmployerReviews(event);

    }


    // ------------------------------------------------------------------------
    // GET /employer/company
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/employer/company'
    ) {

      return await handleGetEmployerCompany(event);

    }


    // ------------------------------------------------------------------------
    // GET /admin/dashboard/overview
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/admin/dashboard/overview'
    ) {

      return await handleGetAdminDashboardOverview(event);

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
    // GET /admin/companies
    // ------------------------------------------------------------------------

    if (
      method === 'GET' &&
      path === '/admin/companies'
    ) {

      return await handleGetAdminCompanies(event);

    }


    // ------------------------------------------------------------------------
    // PATCH /admin/companies/{companyId}/reactivate
    // ------------------------------------------------------------------------

    if (
      method === 'PATCH' &&
      path === '/admin/companies/{companyId}/reactivate'
    ) {

      return await handleReactivateAdminCompany(event);

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

}


// =============================================================================
// MAIN LAMBDA ENTRY POINT
// =============================================================================

exports.handler = async (event) => {

  try {

    const result = await routeRequest(event);

    return addCorsHeaders(result, event);

  } catch (error) {

    console.error(
      'FairWork API unexpected error:',
      error
    );

    return addCorsHeaders(
      response(500, {
        success: false,
        message: 'An internal server error occurred.'
      }),
      event
    );

  }

};
