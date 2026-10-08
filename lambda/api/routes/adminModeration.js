
'use strict';

/*
===============================================================================
 FairWork Pulse - Admin Review Moderation
===============================================================================

 Routes:
   GET  /admin/reviews/flagged
   POST /admin/reviews/{reviewId}/approve
   POST /admin/reviews/{reviewId}/reject

 Security:
   - Cognito authentication required.
   - Cognito ADMIN group membership required.
   - Reviewer identities are never returned by these endpoints.
   - Only FLAGGED reviews may be approved or rejected.
   - Updates are conditional to prevent conflicting decisions.

===============================================================================
*/

const {
  getDatabaseConnection
} = require('../services/database');

const {
  getAuthenticatedUser
} = require('../services/auth');

const {
  response
} = require('../utils/response');


// =============================================================================
// ADMIN AUTHORIZATION
// =============================================================================

function requireAdmin(event) {

  const user = getAuthenticatedUser(event);

  if (!user) {
    return {
      allowed: false,
      result: response(401, {
        success: false,
        message: 'Authentication required.'
      })
    };
  }

  if (
    !Array.isArray(user.groups) ||
    !user.groups.includes('ADMIN')
  ) {
    return {
      allowed: false,
      result: response(403, {
        success: false,
        message: 'Administrator access required.'
      })
    };
  }

  return {
    allowed: true,
    user
  };
}


// =============================================================================
// REVIEW ID VALIDATION
// =============================================================================

function getReviewId(event) {

  const value = event.pathParameters?.reviewId;

  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const reviewId = Number(value);

  if (
    !Number.isSafeInteger(reviewId) ||
    reviewId < 1
  ) {
    return null;
  }

  return reviewId;
}


// =============================================================================
// GET /admin/reviews/flagged
// =============================================================================

async function handleGetFlaggedReviews(event) {

  const authorization = requireAdmin(event);

  if (!authorization.allowed) {
    return authorization.result;
  }

  const connection = await getDatabaseConnection();

  try {

    const [rows] = await connection.execute(
      `
      SELECT
        r.review_id AS reviewId,
        r.company_id AS companyId,
        c.company_name AS companyName,
        r.rating,
        r.review_title AS reviewTitle,
        r.review_text AS reviewText,
        r.moderation_status AS moderationStatus,
        r.moderation_score AS moderationScore,
        r.moderation_reason AS moderationReason,
        r.submitted_at AS submittedAt
      FROM reviews r
      INNER JOIN companies c
        ON c.company_id = r.company_id
      WHERE r.moderation_status = 'FLAGGED'
      ORDER BY r.submitted_at ASC
      LIMIT 100
      `
    );

    return response(200, {
      success: true,
      count: rows.length,
      reviews: rows
    });

  } finally {
    await connection.end();
  }

}


// =============================================================================
// SHARED APPROVE / REJECT OPERATION
// =============================================================================

async function updateReviewStatus(event, targetStatus) {

  const authorization = requireAdmin(event);

  if (!authorization.allowed) {
    return authorization.result;
  }

  const reviewId = getReviewId(event);

  if (!reviewId) {
    return response(400, {
      success: false,
      message: 'Invalid review ID.'
    });
  }

  const connection = await getDatabaseConnection();

  try {

    /*
     * Conditional update:
     *
     * A review can transition only from FLAGGED to
     * HUMAN_APPROVED or HUMAN_REJECTED.
     *
     * If another administrator has already made a decision,
     * the update will not overwrite it.
     */

    const [result] = await connection.execute(
      `
      UPDATE reviews
      SET
        moderation_status = ?,
        moderated_at = UTC_TIMESTAMP()
      WHERE review_id = ?
        AND moderation_status = 'FLAGGED'
      `,
      [
        targetStatus,
        reviewId
      ]
    );

    if (result.affectedRows === 1) {

      console.log('Admin moderation decision', {
        reviewId,
        status: targetStatus,
        adminCognitoSub: authorization.user.cognitoSub
      });

      return response(200, {
        success: true,
        message:
          targetStatus === 'HUMAN_APPROVED'
            ? 'Review approved successfully.'
            : 'Review rejected successfully.',
        review: {
          reviewId,
          status: targetStatus
        }
      });

    }

    /*
     * Determine whether the review is missing or is no
     * longer eligible for human moderation.
     */

    const [rows] = await connection.execute(
      `
      SELECT moderation_status
      FROM reviews
      WHERE review_id = ?
      LIMIT 1
      `,
      [reviewId]
    );

    if (!rows.length) {
      return response(404, {
        success: false,
        message: 'Review not found.'
      });
    }

    return response(409, {
      success: false,
      message:
        'Review cannot be modified because it is not awaiting human moderation.'
    });

  } finally {
    await connection.end();
  }

}


// =============================================================================
// POST /admin/reviews/{reviewId}/approve
// =============================================================================

async function handleApproveReview(event) {

  return updateReviewStatus(
    event,
    'HUMAN_APPROVED'
  );

}


// =============================================================================
// POST /admin/reviews/{reviewId}/reject
// =============================================================================

async function handleRejectReview(event) {

  return updateReviewStatus(
    event,
    'HUMAN_REJECTED'
  );

}


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  handleGetFlaggedReviews,
  handleApproveReview,
  handleRejectReview
};
