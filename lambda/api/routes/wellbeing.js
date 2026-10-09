'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleCreateWellbeingCheckin(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYEE') || !user.cognitoSub) {
    return response(403, { success: false, message: 'Employee access required.' });
  }

  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body;
    body = JSON.parse(raw || '');
  } catch {
    return response(400, { success: false, message: 'A valid JSON body is required.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response(400, { success: false, message: 'JSON body must be an object.' });
  }
  const allowed = ['companyId', 'workloadRating', 'stressRating', 'shiftPressureRating', 'workLifeBalanceRating'];
  if (Object.keys(body).some(k => !allowed.includes(k))) {
    return response(400, { success: false, message: 'Unsupported field in request.' });
  }
  const { companyId, workloadRating, stressRating, shiftPressureRating, workLifeBalanceRating } = body;
  if (!Number.isSafeInteger(companyId) || companyId < 1) {
    return response(400, { success: false, message: 'companyId must be a positive integer.' });
  }
  const ratings = { workloadRating, stressRating, shiftPressureRating, workLifeBalanceRating };
  if (Object.values(ratings).some(v => !Number.isInteger(v) || v < 1 || v > 5)) {
    return response(400, { success: false, message: 'All four ratings must be integers from 1 to 5.' });
  }

  const connection = await getDatabaseConnection();
  try {
    const [rows] = await connection.execute(`
      SELECT u.user_id AS userId, wa.association_id AS associationId
      FROM user_profiles u
      INNER JOIN workplace_associations wa ON wa.user_id = u.user_id
      INNER JOIN companies c ON c.company_id = wa.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND wa.company_id = ? AND wa.status = 'VERIFIED'
        AND (wa.expires_at IS NULL OR wa.expires_at > UTC_TIMESTAMP())
        AND wa.ended_at IS NULL AND c.status = 'ACTIVE'
      ORDER BY wa.verified_at DESC LIMIT 1`, [user.cognitoSub, companyId]);

    if (!rows.length) {
      return response(403, { success: false, message: 'An active verified workplace association is required.' });
    }

    const [result] = await connection.execute(`
      INSERT INTO wellbeing_checkins
        (user_id, company_id, workplace_association_id, workload, stress, shift_pressure, work_life_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rows[0].userId, companyId, rows[0].associationId,
       workloadRating, stressRating, shiftPressureRating, workLifeBalanceRating]);

    console.log('Wellbeing check-in created', { checkinId: result.insertId, companyId });
    return response(201, {
      success: true,
      message: 'Wellbeing check-in submitted successfully.',
      checkin: { checkinId: result.insertId, companyId, submitted: true }
    });
  } finally {
    await connection.end();
  }
}

module.exports = { handleCreateWellbeingCheckin };
