'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleGetWellbeingInsights(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYEE') || !user.cognitoSub) {
    return response(403, { success: false, message: 'Employee access required.' });
  }

  const rawWeeks = event.queryStringParameters?.weeks;
  const weeks = rawWeeks == null ? 6 : Number(rawWeeks);
  if (![4, 6, 12].includes(weeks) || (rawWeeks != null && !['4', '6', '12'].includes(rawWeeks))) {
    return response(400, { success: false, message: 'weeks must be 4, 6 or 12.' });
  }

  const connection = await getDatabaseConnection();
  try {
    const [profiles] = await connection.execute(
      "SELECT user_id FROM user_profiles WHERE cognito_sub = ? AND account_status = 'ACTIVE' LIMIT 1",
      [user.cognitoSub]
    );
    if (!profiles.length) return response(403, { success: false, message: 'Active employee profile required.' });

    // Historical records are included even if an association or company later becomes inactive.
    // Filtering by user_id prevents access to other employees' check-ins.
    const [rows] = await connection.execute(`
      SELECT checkin_id AS checkinId, company_id AS companyId,
             workload, stress, shift_pressure AS shiftPressure,
             work_life_balance AS workLifeBalance,
             DATE_FORMAT(submitted_at, '%Y-%m-%d') AS date,
             DATE_FORMAT(submitted_at, '%Y-%m-%dT%H:%i:%sZ') AS submittedAt
      FROM wellbeing_checkins
      WHERE user_id = ?
        AND submitted_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? WEEK)
      ORDER BY submitted_at ASC, checkin_id ASC
      LIMIT 1000`, [profiles[0].user_id, weeks]);

    const metrics = ['workload', 'stress', 'shiftPressure', 'workLifeBalance'];
    const averages = Object.fromEntries(metrics.map(key => [key,
      rows.length ? Math.round((rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length) * 10) / 10 : null
    ]));
    const checkins = rows.map(row => ({
      checkinId: row.checkinId,
      companyId: row.companyId,
      date: row.date,
      submittedAt: row.submittedAt,
      workload: Number(row.workload),
      stress: Number(row.stress),
      shiftPressure: Number(row.shiftPressure),
      workLifeBalance: Number(row.workLifeBalance)
    }));

    return response(200, {
      success: true,
      periodWeeks: weeks,
      totalCheckins: checkins.length,
      averages,
      trends: checkins.map(({ date, workload, stress, shiftPressure, workLifeBalance }) =>
        ({ date, workload, stress, shiftPressure, workLifeBalance })),
      recentCheckins: [...checkins].reverse().slice(0, 20)
    });
  } finally {
    await connection.end();
  }
}

module.exports = { handleGetWellbeingInsights };
