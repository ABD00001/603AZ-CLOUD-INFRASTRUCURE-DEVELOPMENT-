'use strict';
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleCreateEmployerResponse(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, { success: false, message: 'Employer access required.' });
  }
  const reviewId = Number(event.pathParameters?.reviewId);
  if (!Number.isSafeInteger(reviewId) || reviewId < 1) {
    return response(400, { success: false, message: 'Invalid review ID.' });
  }
  let body;
  try {
    body = JSON.parse(event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}'));
  } catch {
    return response(400, { success: false, message: 'Invalid JSON body.' });
  }
  const responseText = body?.responseText;
  if (typeof responseText !== 'string' || responseText.trim().length < 10 || responseText.trim().length > 3000) {
    return response(400, { success: false, message: 'Response must be 10-3000 characters.' });
  }
  const connection = await getDatabaseConnection();
  try {
    // Authorization and published-review status are checked together.
    // Do not return review author information to employers.
    const [eligible] = await connection.execute(`
      SELECT r.review_id AS reviewId, u.user_id AS employerUserId
      FROM reviews r
      JOIN companies c ON c.company_id = r.company_id
      JOIN employer_company_access eca ON eca.company_id = c.company_id AND eca.status = 'ACTIVE'
      JOIN user_profiles u ON u.user_id = eca.user_id
      WHERE r.review_id = ? AND r.moderation_status IN ('CLEAN', 'HUMAN_APPROVED')
        AND c.status = 'ACTIVE' AND u.cognito_sub = ? AND u.account_status = 'ACTIVE'
      LIMIT 1`, [reviewId, user.cognitoSub]);
    if (!eligible.length) {
      return response(403, { success: false, message: 'Review unavailable or company access denied.' });
    }
    try {
      const [result] = await connection.execute(`
        INSERT INTO employer_responses (review_id, employer_user_id, response_text)
        VALUES (?, ?, ?)`, [reviewId, eligible[0].employerUserId, responseText.trim()]);
      return response(201, {
        success: true,
        message: 'Employer response published.',
        employerResponse: {
          responseId: result.insertId,
          reviewId,
          responseText: responseText.trim()
        }
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
        return response(409, { success: false, message: 'This review already has an employer response.' });
      }
      throw error;
    }
  } finally {
    await connection.end();
  }
}

module.exports = { handleCreateEmployerResponse };
