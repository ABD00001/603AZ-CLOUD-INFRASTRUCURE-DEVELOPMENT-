'use strict';
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');
const sqs = new SQSClient({});

async function handleCreateReview(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, {success:false,message:'Authentication required.'});
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYEE')) return response(403,{success:false,message:'Employee access required.'});
  const companyId = Number(event.pathParameters?.companyId);
  if (!Number.isSafeInteger(companyId) || companyId < 1) return response(400,{success:false,message:'Invalid company ID.'});
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')); }
  catch { return response(400,{success:false,message:'Invalid JSON body.'}); }
  const { rating, reviewTitle, reviewText } = body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 ||
      (reviewTitle != null && (typeof reviewTitle !== 'string' || reviewTitle.trim().length > 150)) ||
      typeof reviewText !== 'string' || reviewText.trim().length < 10 || reviewText.trim().length > 5000) {
    return response(400,{success:false,message:'Rating must be 1-5, title at most 150 characters, and review text 10-5000 characters.'});
  }
  const title = typeof reviewTitle === 'string' ? reviewTitle.trim() : null;
  const connection = await getDatabaseConnection();
  let reviewId;
  try {
    const [rows] = await connection.execute(`
      SELECT wa.association_id FROM user_profiles u
      INNER JOIN workplace_associations wa ON wa.user_id = u.user_id
      INNER JOIN companies c ON c.company_id = wa.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND wa.company_id = ? AND wa.status = 'VERIFIED'
        AND (wa.expires_at IS NULL OR wa.expires_at > UTC_TIMESTAMP())
        AND wa.ended_at IS NULL AND c.status = 'ACTIVE'
      ORDER BY wa.verified_at DESC LIMIT 1`, [user.cognitoSub, companyId]);
    if (!rows.length) return response(403,{success:false,message:'An active verified workplace association is required.'});
    const [result] = await connection.execute(`
      INSERT INTO reviews (user_id, company_id, workplace_association_id, rating, review_title, review_text, moderation_status)
      SELECT u.user_id, ?, ?, ?, ?, ?, 'PENDING_ANALYSIS'
      FROM user_profiles u WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'`,
      [companyId, rows[0].association_id, rating, title, reviewText.trim(), user.cognitoSub]);
    if (result.affectedRows !== 1) return response(403,{success:false,message:'Active profile required.'});
    reviewId = result.insertId;
    // If SQS fails, the review stays non-public and is marked ANALYSIS_FAILED.
    try {
      await sqs.send(new SendMessageCommand({QueueUrl:process.env.MODERATION_QUEUE_URL, MessageBody:JSON.stringify({reviewId})}));
    } catch (error) {
      console.error('Review enqueue failed', {reviewId,code:error.code,message:error.message});
      await connection.execute("UPDATE reviews SET moderation_status = 'ANALYSIS_FAILED' WHERE review_id = ? AND moderation_status = 'PENDING_ANALYSIS'",[reviewId]);
      return response(503,{success:false,message:'Review saved but moderation is unavailable; please contact support.',reviewId});
    }
    return response(202,{success:true,message:'Review accepted for moderation.',review:{reviewId,companyId,status:'PENDING_ANALYSIS'}});
  } finally { await connection.end(); }
}

async function handleGetPublishedReviews(event) {
  const companyId = Number(event.pathParameters?.companyId);
  if (!Number.isSafeInteger(companyId) || companyId < 1) return response(400,{success:false,message:'Invalid company ID.'});
  const connection = await getDatabaseConnection();
  try {
    const [rows] = await connection.execute(`
      SELECT review_id AS reviewId, company_id AS companyId, rating,
             review_title AS reviewTitle, review_text AS reviewText, submitted_at AS submittedAt
      FROM reviews WHERE company_id = ? AND moderation_status IN ('CLEAN','HUMAN_APPROVED')
      ORDER BY submitted_at DESC LIMIT 50`, [companyId]);
    return response(200,{success:true,count:rows.length,reviews:rows});
  } finally { await connection.end(); }
}
module.exports = {handleCreateReview,handleGetPublishedReviews};
