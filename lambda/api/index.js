
'use strict';

/*
===============================================================================
 FairWork Pulse - API Lambda Entry Point
===============================================================================

 Routes:
   GET    /health
   GET    /profile
   GET    /companies
   GET    /companies/{companyId}
   GET    /workplace-associations
   POST   /workplace-associations/verify
   POST   /companies/{companyId}/verification-codes
   POST   /admin/companies/{companyId}/employer-codes
   POST   /employer/registration/redeem
   POST   /companies/{companyId}/reviews
   GET    /companies/{companyId}/reviews
   GET    /employee/reviews
   POST   /employee/wellbeing/checkins
   GET    /employee/wellbeing/insights
   GET    /employer/company
   GET    /employer/reviews
   GET    /employer/dashboard/overview
   GET    /employer/analytics/wellbeing
   POST   /employer/reviews/{reviewId}/response
   GET    /admin/dashboard/overview
   GET    /admin/reviews/flagged
   POST   /admin/reviews/{reviewId}/approve
   POST   /admin/reviews/{reviewId}/reject
   POST   /admin/companies
   PATCH  /admin/companies/{companyId}
   DELETE /admin/companies/{companyId}

===============================================================================
*/

// HEALTH
const {
  handleHealth
} = require('./routes/health');

// USER PROFILE
const {
  handleGetProfile
} = require('./routes/profile');

// COMPANIES
const {
  handleGetCompanies,
  handleGetCompany
} = require('./routes/companies');

// WORKPLACE ASSOCIATIONS
const {
  handleGetWorkplaceAssociations,
  handleVerifyWorkplaceAssociation
} = require('./routes/workplace');

// VERIFICATION CODES
const {
  handleGenerateVerificationCodes
} = require('./routes/verificationCodes');

// ADMIN EMPLOYER CODE GENERATION
const {
  handleGenerateEmployerCodes
} = require('./routes/adminEmployerCodes');

// NEW: EMPLOYER REGISTRATION
const {
  handleRedeemEmployerCode
} = require('./routes/employerRegistration');

// REVIEWS
const {
  handleCreateReview,
  handleGetPublishedReviews
} = require('./routes/reviews');

// EMPLOYEE REVIEWS
const {
  handleGetEmployeeReviews
} = require('./routes/employeeReviews');

// EMPLOYEE WELLBEING
const {
  handleCreateWellbeingCheckin
} = require('./routes/wellbeing');

const {
  handleGetWellbeingInsights
} = require('./routes/wellbeingInsights');

// EMPLOYER
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

// ADMIN DASHBOARD
const {
  handleGetAdminDashboardOverview
} = require('./routes/adminDashboardOverview');

// ADMIN MODERATION
const {
  handleGetFlaggedReviews,
  handleApproveReview,
  handleRejectReview
} = require('./routes/adminModeration');

// ADMIN COMPANY MANAGEMENT
const {
  handleCreateCompany,
  handleUpdateCompany,
  handleDeleteCompany
} = require('./routes/adminCompanies');

// RESPONSE UTILITY
const {
  response
} = require('./utils/response');

// REQUEST INFORMATION
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

// MAIN HANDLER
exports.handler = async (event) => {
  const method = getHttpMethod(event);
  const path = getPath(event);

  console.log(
    'FairWork API request:',
    JSON.stringify({ method, path })
  );

  try {

    // HEALTH
    if (method === 'GET' && path === '/health') {
      return await handleHealth();
    }

    // PROFILE
    if (method === 'GET' && path === '/profile') {
      return await handleGetProfile(event);
    }

    // COMPANIES
    if (method === 'GET' && path === '/companies') {
      return await handleGetCompanies();
    }

    if (
      method === 'GET' &&
      path === '/companies/{companyId}'
    ) {
      return await handleGetCompany(event);
    }

    // WORKPLACE ASSOCIATIONS
    if (
      method === 'GET' &&
      path === '/workplace-associations'
    ) {
      return await handleGetWorkplaceAssociations(event);
    }

    if (
      method === 'POST' &&
      path === '/workplace-associations/verify'
    ) {
      return await handleVerifyWorkplaceAssociation(event);
    }

    // EMPLOYEE VERIFICATION CODES
    if (
      method === 'POST' &&
      path === '/companies/{companyId}/verification-codes'
    ) {
      return await handleGenerateVerificationCodes(event);
    }

    // ADMIN GENERATES EMPLOYER CODES
    if (
      method === 'POST' &&
      path === '/admin/companies/{companyId}/employer-codes'
    ) {
      return await handleGenerateEmployerCodes(event);
    }

    // NEW: EMPLOYER REDEEMS REGISTRATION CODE
    if (
      method === 'POST' &&
      path === '/employer/registration/redeem'
    ) {
      return await handleRedeemEmployerCode(event);
    }

    // COMPANY REVIEWS
    if (
      method === 'POST' &&
      path === '/companies/{companyId}/reviews'
    ) {
      return await handleCreateReview(event);
    }

    if (
      method === 'GET' &&
      path === '/companies/{companyId}/reviews'
    ) {
      return await handleGetPublishedReviews(event);
    }

    // EMPLOYEE REVIEWS
    if (
      method === 'GET' &&
      path === '/employee/reviews'
    ) {
      return await handleGetEmployeeReviews(event);
    }

    // EMPLOYEE WELLBEING
    if (
      method === 'POST' &&
      path === '/employee/wellbeing/checkins'
    ) {
      return await handleCreateWellbeingCheckin(event);
    }

    if (
      method === 'GET' &&
      path === '/employee/wellbeing/insights'
    ) {
      return await handleGetWellbeingInsights(event);
    }

    // EMPLOYER RESPONSE TO REVIEW
    if (
      method === 'POST' &&
      path === '/employer/reviews/{reviewId}/response'
    ) {
      return await handleCreateEmployerResponse(event);
    }

    // EMPLOYER DASHBOARD
    if (
      method === 'GET' &&
      path === '/employer/dashboard/overview'
    ) {
      return await handleGetEmployerDashboardOverview(event);
    }

    // EMPLOYER WELLBEING ANALYTICS
    if (
      method === 'GET' &&
      path === '/employer/analytics/wellbeing'
    ) {
      return await handleGetEmployerWellbeingAnalytics(event);
    }

    // EMPLOYER REVIEWS
    if (
      method === 'GET' &&
      path === '/employer/reviews'
    ) {
      return await handleGetEmployerReviews(event);
    }

    // EMPLOYER COMPANY
    if (
      method === 'GET' &&
      path === '/employer/company'
    ) {
      return await handleGetEmployerCompany(event);
    }

    // ADMIN DASHBOARD
    if (
      method === 'GET' &&
      path === '/admin/dashboard/overview'
    ) {
      return await handleGetAdminDashboardOverview(event);
    }

    // ADMIN MODERATION
    if (
      method === 'GET' &&
      path === '/admin/reviews/flagged'
    ) {
      return await handleGetFlaggedReviews(event);
    }

    if (
      method === 'POST' &&
      path === '/admin/reviews/{reviewId}/approve'
    ) {
      return await handleApproveReview(event);
    }

    if (
      method === 'POST' &&
      path === '/admin/reviews/{reviewId}/reject'
    ) {
      return await handleRejectReview(event);
    }

    // ADMIN COMPANY MANAGEMENT
    if (
      method === 'POST' &&
      path === '/admin/companies'
    ) {
      return await handleCreateCompany(event);
    }

    if (
      method === 'PATCH' &&
      path === '/admin/companies/{companyId}'
    ) {
      return await handleUpdateCompany(event);
    }

    if (
      method === 'DELETE' &&
      path === '/admin/companies/{companyId}'
    ) {
      return await handleDeleteCompany(event);
    }

    // UNKNOWN ROUTE
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
