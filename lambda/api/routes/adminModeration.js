'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

function requireAdmin(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return { result: response(401, { success: false, message: 'Authentication required.' }) };
  if (!Array.isArray(user.groups) || !user.groups.includes('ADMIN') || !user.cognitoSub) {
    return { result: response(403, { success: false, message: 'Administrator access required.' }) };
  }
  return { user };
}

async function activeAdmin(connection, sub) {
  const [rows] = await connection.execute(
    "SELECT user_id FROM user_profiles WHERE cognito_sub = ? AND account_status = 'ACTIVE' LIMIT 1", [sub]
  );
  return rows[0] || null;
}

function getReviewId(event) {
  const raw = event.pathParameters?.reviewId;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

// Backward compatible: no status query still returns FLAGGED reviews.
// ?status=PENDING | APPROVED | REJECTED switches the moderation-page tab.
async function handleGetFlaggedReviews(event) {
  const auth = requireAdmin(event);
  if (auth.result) return auth.result;

  const requested = String(event.queryStringParameters?.status || 'PENDING').toUpperCase();
  const statuses = {
    PENDING: 'FLAGGED',
    FLAGGED: 'FLAGGED',
    APPROVED: 'HUMAN_APPROVED',
    HUMAN_APPROVED: 'HUMAN_APPROVED',
    REJECTED: 'HUMAN_REJECTED',
    HUMAN_REJECTED: 'HUMAN_REJECTED'
  };
  const status = statuses[requested];
  if (!status) return response(400, { success: false, message: 'status must be PENDING, APPROVED or REJECTED.' });

  const connection = await getDatabaseConnection();
  try {
    if (!await activeAdmin(connection, auth.user.cognitoSub)) {
      return response(403, { success: false, message: 'An active administrator profile is required.' });
    }
    const [counts] = await connection.execute(
      'SELECT COUNT(*) AS total FROM reviews WHERE moderation_status = ?', [status]
    );
    const [rows] = await connection.execute(`
      SELECT r.review_id AS reviewId, r.company_id AS companyId,
             c.name AS companyName, r.rating,
             r.review_title AS reviewTitle, r.review_text AS reviewText,
             r.moderation_status AS moderationStatus,
             r.moderation_score AS moderationScore,
             r.moderation_reason AS moderationReason,
             r.submitted_at AS submittedAt, r.moderated_at AS moderatedAt
      FROM reviews r
      INNER JOIN companies c ON c.company_id = r.company_id
      WHERE r.moderation_status = ?
      ORDER BY r.submitted_at DESC, r.review_id DESC
      LIMIT 100`, [status]
    );
    return response(200, {
      success: true,
      status: requested,
      count: rows.length,
      total: Number(counts[0].total),
      reviews: rows
    });
  } finally {
    await connection.end();
  }
}

async function updateReviewStatus(event, targetStatus) {
  const auth = requireAdmin(event);
  if (auth.result) return auth.result;
  const reviewId = getReviewId(event);
  if (!reviewId) return response(400, { success: false, message: 'Invalid review ID.' });

  const connection = await getDatabaseConnection();
  try {
    const admin = await activeAdmin(connection, auth.user.cognitoSub);
    if (!admin) return response(403, { success: false, message: 'An active administrator profile is required.' });

    const [result] = await connection.execute(`
      UPDATE reviews SET moderation_status = ?, moderated_by = ?, moderated_at = UTC_TIMESTAMP()
      WHERE review_id = ? AND moderation_status = 'FLAGGED'
    `, [targetStatus, admin.user_id, reviewId]);

    if (result.affectedRows === 1) {
      return response(200, {
        success: true,
        message: targetStatus === 'HUMAN_APPROVED' ? 'Review approved successfully.' : 'Review rejected successfully.',
        review: { reviewId, status: targetStatus }
      });
    }
    const [rows] = await connection.execute(
      'SELECT moderation_status FROM reviews WHERE review_id = ? LIMIT 1', [reviewId]
    );
    if (!rows.length) return response(404, { success: false, message: 'Review not found.' });
    return response(409, {
      success: false,
      message: 'Review is not awaiting human moderation.',
      currentStatus: rows[0].moderation_status
    });
  } finally {
    await connection.end();
  }
}

async function handleApproveReview(event) {
  return updateReviewStatus(event, 'HUMAN_APPROVED');
}
async function handleRejectReview(event) {
  return updateReviewStatus(event, 'HUMAN_REJECTED');
}

module.exports = { handleGetFlaggedReviews, handleApproveReview, handleRejectReview };
