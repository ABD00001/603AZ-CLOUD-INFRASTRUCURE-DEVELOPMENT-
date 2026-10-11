'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleGetAdminDashboardOverview(event) {
  const user = getAuthenticatedUser(event);
  if (!user) {
    return response(401, { success: false, message: 'Authentication required.' });
  }
  if (!Array.isArray(user.groups) || !user.groups.includes('ADMIN') || !user.cognitoSub) {
    return response(403, { success: false, message: 'Administrator access required.' });
  }

  const connection = await getDatabaseConnection();
  try {
    const [profiles] = await connection.execute(
      `SELECT user_id FROM user_profiles
       WHERE cognito_sub = ? AND account_status = 'ACTIVE' LIMIT 1`,
      [user.cognitoSub]
    );
    if (!profiles.length) {
      return response(403, {
        success: false,
        message: 'An active administrator profile is required.'
      });
    }

    // Counts come from the database, not the capped flagged-reviews listing.
    // Approved and rejected mean HUMAN decisions only.
    const [companyRows] = await connection.execute(
      `SELECT COUNT(*) AS activeCompanies
       FROM companies WHERE status = 'ACTIVE'`
    );
    const [reviewRows] = await connection.execute(
      `SELECT
         COALESCE(SUM(moderation_status = 'FLAGGED'), 0) AS flaggedReviews,
         COALESCE(SUM(moderation_status = 'HUMAN_APPROVED'), 0) AS approvedReviews,
         COALESCE(SUM(moderation_status = 'HUMAN_REJECTED'), 0) AS rejectedReviews
       FROM reviews`
    );

    return response(200, {
      success: true,
      stats: {
        activeCompanies: Number(companyRows[0].activeCompanies),
        flaggedReviews: Number(reviewRows[0].flaggedReviews),
        approvedReviews: Number(reviewRows[0].approvedReviews),
        rejectedReviews: Number(reviewRows[0].rejectedReviews)
      }
    });
  } finally {
    await connection.end();
  }
}

module.exports = { handleGetAdminDashboardOverview };
