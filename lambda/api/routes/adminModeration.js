
'use strict';

/*
===============================================================================
 FairWork Pulse - Admin Review Moderation
===============================================================================

 GET  /admin/reviews/flagged
 POST /admin/reviews/{reviewId}/approve
 POST /admin/reviews/{reviewId}/reject

 Uses the V001 database schema.
 Only Cognito ADMIN users with an ACTIVE application profile
 may make moderation decisions.

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
// AUTHORIZATION
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
    !user.groups.includes('ADMIN') ||
    !user.cognitoSub
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
// ACTIVE ADMIN PROFILE
// =============================================================================

async function getActiveAdminProfile(connection, cognitoSub) {

  const [rows] = await connection.execute(
    `
      SELECT user_id
      FROM user_profiles
      WHERE cognito_sub = ?
        AND account_status = 'ACTIVE'
      LIMIT 1
    `,
    [cognitoSub]
  );

  return rows.length ? rows[0] : null;
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

  const auth = requireAdmin(event);

  if (!auth.allowed) {
    return auth.result;
  }

  const connection = await getDatabaseConnection();

  try {

    const admin = await getActiveAdminProfile(
      connection,
      auth.user.cognitoSub
    );

    if (!admin) {
      return response(403, {
        success: false,
        message: 'An active administrator profile is required.'
      });
    }

    const [rows] = await connection.execute(
      `
        SELECT
          r.review_id AS reviewId,
          r.company_id AS companyId,
          c.name AS companyName,
          r.rating,
          r.review_title AS reviewTitle,
          r.review_text AS reviewText,
          r.moderation_status AS moderationStatus,
          r.moderation_score AS moderationScore,
          r.moderation_reason AS moderationReason,
          r.submitted_at AS submittedAt,
          r.moderated_at AS moderatedAt

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
// SHARED APPROVE / REJECT LOGIC
// =============================================================================

async function updateReviewStatus(event, targetStatus) {

  const auth = requireAdmin(event);

  if (!auth.allowed) {
    return auth.result;
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

    const admin = await getActiveAdminProfile(
      connection,
      auth.user.cognitoSub
    );

    if (!admin) {
      return response(403, {
        success: false,
        message: 'An active administrator profile is required.'
      });
    }

    /*
     * Atomic conditional update:
     *
     * - Only FLAGGED reviews can be changed.
     * - Record the administrator's database user ID.
     * - Record the decision timestamp.
     * - Preserve automated moderation score and reason.
     */

    const [result] = await connection.execute(
      `
        UPDATE reviews

        SET
          moderation_status = ?,
          moderated_by = ?,
          moderated_at = UTC_TIMESTAMP()

        WHERE review_id = ?
          AND moderation_status = 'FLAGGED'
      `,
      [
        targetStatus,
        admin.user_id,
        reviewId
      ]
    );

    if (result.affectedRows === 1) {

      console.log('Admin moderation decision:', {
        reviewId,
        status: targetStatus,
        adminUserId: admin.user_id
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

    const [rows] = await connection.execute(
      `
        SELECT moderation_status
        FROM reviews
        WHERE review_id = ?
        LIMIT 1
      `,
      [reviewId]
    );

    if (rows.length === 0) {
      return response(404, {
        success: false,
        message: 'Review not found.'
      });
    }

    return response(409, {
      success: false,
      message:
        'Review is not awaiting human moderation.',
      currentStatus: rows[0].moderation_status
    });

  } finally {
    await connection.end();
  }
}


// =============================================================================
// APPROVE REVIEW
// =============================================================================

async function handleApproveReview(event) {

  return updateReviewStatus(
    event,
    'HUMAN_APPROVED'
  );
}


// =============================================================================
// REJECT REVIEW
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
