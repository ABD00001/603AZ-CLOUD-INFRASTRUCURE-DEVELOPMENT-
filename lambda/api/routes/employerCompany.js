'use strict';
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

async function handleGetEmployerCompany(event) {
  const user = getAuthenticatedUser(event);
  if (!user) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, { success: false, message: 'Employer access required.' });
  }
  const connection = await getDatabaseConnection();
  try {
    const [rows] = await connection.execute(`
      SELECT c.company_id AS companyId, c.name, c.industry, c.location,
             c.description, c.website, c.status, e.granted_at AS grantedAt
      FROM user_profiles u
      INNER JOIN employer_company_access e ON e.user_id = u.user_id
      INNER JOIN companies c ON c.company_id = e.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND e.status = 'ACTIVE' AND e.revoked_at IS NULL
        AND c.status = 'ACTIVE'
      ORDER BY c.company_id ASC`, [user.cognitoSub]);
    return response(200, { success: true, count: rows.length, companies: rows,
      company: rows.length === 1 ? rows[0] : null });
  } finally {
    await connection.end();
  }
}
module.exports = { handleGetEmployerCompany };
