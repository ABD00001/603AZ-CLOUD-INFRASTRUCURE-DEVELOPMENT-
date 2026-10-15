'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');
const { handleGetEmployerWellbeingAnalytics } = require('./employerWellbeingAnalytics');

async function handleGetEmployerDashboardOverview(event) {
  const user = getAuthenticatedUser(event);
  if (!user || !user.cognitoSub) {
    return response(401, { success: false, message: 'Authentication required.' });
  }
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, { success: false, message: 'Employer access required.' });
  }

  // Fixed seven-day wellbeing period. Preserve companyId for multi-company employers.
  const params = event.queryStringParameters || {};
  if (params.weeks != null) {
    return response(400, {
      success: false,
      message: 'Overview is fixed to 1 week. Remove the weeks parameter.'
    });
  }
  const analyticsEvent = {
    ...event,
    queryStringParameters: { ...(params || {}), weeks: '1' }
  };

  // Reuse the existing, tested aggregation, employer access checks and
  // minimum-distinct-contributor suppression. Do not recalculate scores here.
  const analyticsResult = await handleGetEmployerWellbeingAnalytics(analyticsEvent);
  if (Number(analyticsResult.statusCode) !== 200) return analyticsResult;

  const analytics = JSON.parse(analyticsResult.body || '{}');
  if (!analytics.success || !analytics.company?.companyId) {
    throw new Error('Unexpected employer analytics response.');
  }

  const companyId = Number(analytics.company.companyId);
  const connection = await getDatabaseConnection();
  try {
    // Recheck active employer-company access for the review queries.
    const [access] = await connection.execute(`
      SELECT c.company_id AS companyId, c.name
      FROM user_profiles u
      JOIN employer_company_access e ON e.user_id = u.user_id
      JOIN companies c ON c.company_id = e.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND e.status = 'ACTIVE' AND e.revoked_at IS NULL AND c.company_id = ?
      LIMIT 1
    `, [user.cognitoSub, companyId]);
    if (!access.length) {
      return response(403, { success: false, message: 'Company access denied.' });
    }

    // Counts are not limited by the employer reviews endpoint's LIMIT 100.
    // EXISTS avoids multiplying reviews if response rows are duplicated.
    const [counts] = await connection.execute(`
      SELECT
        COUNT(*) AS totalReviews,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM employer_responses er WHERE er.review_id = r.review_id
        ) THEN 0 ELSE 1 END) AS needsResponse,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM employer_responses er WHERE er.review_id = r.review_id
        ) THEN 1 ELSE 0 END) AS responded
      FROM reviews r
      WHERE r.company_id = ?
        AND r.moderation_status IN ('CLEAN', 'HUMAN_APPROVED')
    `, [companyId]);

    const [recentRows] = await connection.execute(`
      SELECT r.review_id AS reviewId, r.rating,
             r.review_title AS reviewTitle, r.review_text AS reviewText,
             r.submitted_at AS submittedAt,
             er.response_id AS responseId, er.response_text AS responseText,
             er.created_at AS respondedAt
      FROM reviews r
      LEFT JOIN employer_responses er ON er.response_id = (
        SELECT er2.response_id
        FROM employer_responses er2
        WHERE er2.review_id = r.review_id
        ORDER BY er2.response_id DESC LIMIT 1
      )
      WHERE r.company_id = ?
        AND r.moderation_status IN ('CLEAN', 'HUMAN_APPROVED')
      ORDER BY r.submitted_at DESC, r.review_id DESC
      LIMIT 3
    `, [companyId]);

    const recentReviews = recentRows.map(row => ({
      reviewId: row.reviewId,
      rating: row.rating,
      reviewTitle: row.reviewTitle,
      reviewText: row.reviewText,
      submittedAt: row.submittedAt,
      responseStatus: row.responseId == null ? 'NEEDS_RESPONSE' : 'RESPONDED',
      employerResponse: row.responseId == null ? null : {
        responseId: row.responseId,
        responseText: row.responseText,
        respondedAt: row.respondedAt
      }
    }));

    const count = counts[0] || {};
    return response(200, {
      success: true,
      company: analytics.company,
      stats: {
        totalReviews: Number(count.totalReviews || 0),
        needsResponse: Number(count.needsResponse || 0),
        responded: Number(count.responded || 0),
        employeeCheckins: analytics.participation?.checkins ?? null
      },
      wellbeing: {
        periodWeeks: 1,
        trendGranularity: analytics.trendGranularity,
        asOfUtc: analytics.asOfUtc,
        privacy: analytics.privacy,
        scoring: analytics.scoring,
        sufficientData: analytics.sufficientData,
        overallPulse: analytics.overallPulse,
        averages: analytics.averages,
        weeklyTrends: analytics.weeklyTrends,
        keyIndicators: analytics.keyIndicators,
        participation: analytics.participation
      },
      recentReviews
    });
  } finally {
    await connection.end();
  }
}

module.exports = { handleGetEmployerDashboardOverview };
