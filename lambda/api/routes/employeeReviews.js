'use strict';
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleGetEmployeeReviews(event) {
  const user = getAuthenticatedUser(event);
  if (!user || !user.cognitoSub) {
    return response(401, { success: false, message: 'Authentication required.' });
  }
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYEE')) {
    return response(403, { success: false, message: 'Employee access required.' });
  }

  const connection = await getDatabaseConnection();
  try {
    const [profiles] = await connection.execute(
      `SELECT user_id FROM user_profiles
       WHERE cognito_sub = ? AND account_status = 'ACTIVE' LIMIT 1`,
      [user.cognitoSub]
    );
    if (!profiles.length) {
      return response(403, { success: false, message: 'Active employee profile required.' });
    }

    const [reviews] = await connection.execute(
      `SELECT r.review_id AS reviewId,
              r.company_id AS companyId,
              c.name AS companyName,
              r.rating,
              r.review_title AS reviewTitle,
              r.review_text AS reviewText,
              r.moderation_status AS moderationStatus,
              r.submitted_at AS submittedAt,
              er.response_id AS responseId,
              er.response_text AS responseText,
              er.created_at AS respondedAt
       FROM reviews r
       INNER JOIN companies c ON c.company_id = r.company_id
       LEFT JOIN employer_responses er ON er.review_id = r.review_id
       WHERE r.user_id = ?
       ORDER BY r.submitted_at DESC, r.review_id DESC
       LIMIT 100`,
      [profiles[0].user_id]
    );

    const publicStatus = {
      PENDING_ANALYSIS: 'PENDING',
      ANALYSIS_FAILED: 'PROCESSING_FAILED',
      FLAGGED: 'UNDER_REVIEW',
      CLEAN: 'PUBLISHED',
      HUMAN_APPROVED: 'PUBLISHED',
      HUMAN_REJECTED: 'REJECTED'
    };
    const items = reviews.map(({ moderationStatus, responseId, responseText, respondedAt, ...review }) => ({
      ...review,
      status: publicStatus[moderationStatus] || 'PENDING',
      employerResponse: ['CLEAN','HUMAN_APPROVED'].includes(moderationStatus) && responseId != null
        ? { responseId, responseText, respondedAt }
        : null
    }));

    return response(200, { success: true, count: items.length, reviews: items });
  } finally {
    await connection.end();
  }
}

module.exports = { handleGetEmployeeReviews };
