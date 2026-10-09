'use strict';
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleGetEmployerReviews(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, { success: false, message: 'Employer access required.' });
  }
  const rawId = event.queryStringParameters?.companyId;
  let requestedId = null;
  if (rawId !== undefined && rawId !== null) {
    if (!/^[1-9]\d*$/.test(String(rawId)) || !Number.isSafeInteger(Number(rawId))) {
      return response(400, { success: false, message: 'Invalid companyId query parameter.' });
    }
    requestedId = Number(rawId);
  }
  const connection = await getDatabaseConnection();
  try {
    const [companies] = await connection.execute(`
      SELECT c.company_id AS companyId, c.name
      FROM user_profiles u
      JOIN employer_company_access e ON e.user_id = u.user_id
      JOIN companies c ON c.company_id = e.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND e.status = 'ACTIVE' AND e.revoked_at IS NULL
        AND c.status = 'ACTIVE'
      ORDER BY c.company_id`, [user.cognitoSub]);
    if (!companies.length) return response(403, { success: false, message: 'No active company access.' });
    let company;
    if (requestedId !== null) {
      company = companies.find(c => Number(c.companyId) === requestedId);
      if (!company) return response(403, { success: false, message: 'Company access denied.' });
    } else if (companies.length === 1) {
      company = companies[0];
    } else {
      return response(400, { success: false, message: 'Specify companyId when managing multiple companies.', companies: companies.map(c => ({companyId:c.companyId,name:c.name})) });
    }
    const [rows] = await connection.execute(`
      SELECT r.review_id AS reviewId, r.company_id AS companyId, r.rating,
             r.review_title AS reviewTitle, r.review_text AS reviewText,
             r.submitted_at AS submittedAt,
             er.response_id AS responseId, er.response_text AS responseText,
             er.created_at AS respondedAt
      FROM reviews r
      LEFT JOIN employer_responses er ON er.review_id = r.review_id
      WHERE r.company_id = ? AND r.moderation_status IN ('CLEAN','HUMAN_APPROVED')
      ORDER BY r.submitted_at DESC, r.review_id DESC
      LIMIT 100`, [company.companyId]);
    const reviews = rows.map(({responseId, responseText, respondedAt, ...review}) => ({
      ...review,
      employerResponse: responseId == null ? null : {responseId, responseText, respondedAt}
    }));
    return response(200, { success: true, company: { companyId: company.companyId, name: company.name }, count: reviews.length, reviews });
  } finally {
    await connection.end();
  }
}
module.exports = { handleGetEmployerReviews };
