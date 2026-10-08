
'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

// =============================================================================
// EDITABLE COMPANY FIELDS
// =============================================================================

const EDITABLE = {
  name: 150,
  industry: 100,
  location: 150,
  description: 10000,
  website: 255
};

// =============================================================================
// ADMIN AUTHORIZATION
// =============================================================================

function requireAdmin(event) {
  const user = getAuthenticatedUser(event);

  if (!user) {
    return {
      error: response(401, {
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
      error: response(403, {
        success: false,
        message: 'Administrator access required.'
      })
    };
  }

  return { user };
}

// =============================================================================
// VERIFY ACTIVE ADMIN PROFILE
// =============================================================================

async function getAdminProfile(connection, cognitoSub) {
  const [rows] = await connection.execute(
    `SELECT user_id
     FROM user_profiles
     WHERE cognito_sub = ?
       AND account_status = 'ACTIVE'
     LIMIT 1`,
    [cognitoSub]
  );

  return rows[0] || null;
}

// =============================================================================
// REQUEST BODY VALIDATION
// =============================================================================

function parseBody(event) {
  let body;

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');

    body = JSON.parse(raw);
  } catch {
    return {
      error: response(400, {
        success: false,
        message: 'A valid JSON body is required.'
      })
    };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: response(400, {
        success: false,
        message: 'JSON body must be an object.'
      })
    };
  }

  const keys = Object.keys(body);

  if (
    !keys.length ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(EDITABLE, key))
  ) {
    return {
      error: response(400, {
        success: false,
        message: 'Body is empty or contains unsupported fields.'
      })
    };
  }

  const values = {};

  for (const key of keys) {
    const value = body[key];

    if (key === 'name') {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > EDITABLE.name
      ) {
        return {
          error: response(400, {
            success: false,
            message: 'Name must be 1-150 characters.'
          })
        };
      }

      values.name = value.trim();

    } else if (value === null) {
      values[key] = null;

    } else if (
      typeof value === 'string' &&
      value.trim().length <= EDITABLE[key]
    ) {
      values[key] = value.trim() || null;

    } else {
      return {
        error: response(400, {
          success: false,
          message: `Invalid ${key}; maximum ${EDITABLE[key]} characters.`
        })
      };
    }
  }

  if (values.website) {
    try {
      const url = new URL(values.website);

      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !url.hostname.includes('.')
      ) {
        throw new Error('Invalid URL');
      }
    } catch {
      return {
        error: response(400, {
          success: false,
          message: 'Website must be a valid http(s) URL.'
        })
      };
    }
  }

  return { values };
}

// =============================================================================
// COMPANY ID VALIDATION
// =============================================================================

function companyIdFrom(event) {
  const raw = event.pathParameters?.companyId;

  if (
    typeof raw !== 'string' ||
    !/^[1-9]\d*$/.test(raw)
  ) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) ? id : null;
}

// =============================================================================
// FETCH COMPANY
// =============================================================================

async function fetchCompany(connection, id) {
  const [rows] = await connection.execute(
    `SELECT
       company_id AS companyId,
       name,
       industry,
       location,
       description,
       website,
       status,
       created_by AS createdBy,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM companies
     WHERE company_id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

// =============================================================================
// POST /admin/companies
// CREATE COMPANY
// =============================================================================

async function handleCreateAdminCompany(event) {
  const auth = requireAdmin(event);

  if (auth.error) return auth.error;

  const parsed = parseBody(event);

  if (parsed.error) return parsed.error;

  if (!parsed.values.name) {
    return response(400, {
      success: false,
      message: 'Company name is required.'
    });
  }

  const connection = await getDatabaseConnection();

  try {
    const admin = await getAdminProfile(
      connection,
      auth.user.cognitoSub
    );

    if (!admin) {
      return response(403, {
        success: false,
        message: 'Active administrator profile required.'
      });
    }

    const v = parsed.values;

    const [result] = await connection.execute(
      `INSERT INTO companies
       (
         name,
         industry,
         location,
         description,
         website,
         status,
         created_by
       )
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [
        v.name,
        v.industry ?? null,
        v.location ?? null,
        v.description ?? null,
        v.website ?? null,
        admin.user_id
      ]
    );

    const company = await fetchCompany(
      connection,
      result.insertId
    );

    console.log('Admin company created', {
      companyId: result.insertId,
      adminUserId: admin.user_id
    });

    return response(201, {
      success: true,
      message: 'Company created successfully.',
      company
    });

  } finally {
    await connection.end();
  }
}

// =============================================================================
// PATCH /admin/companies/{companyId}
// UPDATE COMPANY
// =============================================================================

async function handleUpdateAdminCompany(event) {
  const auth = requireAdmin(event);

  if (auth.error) return auth.error;

  const companyId = companyIdFrom(event);

  if (!companyId) {
    return response(400, {
      success: false,
      message: 'Invalid company ID.'
    });
  }

  const parsed = parseBody(event);

  if (parsed.error) return parsed.error;

  const connection = await getDatabaseConnection();

  try {
    const admin = await getAdminProfile(
      connection,
      auth.user.cognitoSub
    );

    if (!admin) {
      return response(403, {
        success: false,
        message: 'Active administrator profile required.'
      });
    }

    const existing = await fetchCompany(
      connection,
      companyId
    );

    if (!existing) {
      return response(404, {
        success: false,
        message: 'Company not found.'
      });
    }

    if (existing.status !== 'ACTIVE') {
      return response(409, {
        success: false,
        message: 'Inactive company cannot be edited.'
      });
    }

    const keys = Object.keys(parsed.values);

    const setters = keys
      .map(key => `${key} = ?`)
      .join(', ');

    const params = keys.map(
      key => parsed.values[key]
    );

    const [result] = await connection.execute(
      `UPDATE companies
       SET ${setters}
       WHERE company_id = ?
         AND status = 'ACTIVE'`,
      [...params, companyId]
    );

    if (!result.affectedRows) {
      return response(409, {
        success: false,
        message: 'Company is no longer active.'
      });
    }

    const company = await fetchCompany(
      connection,
      companyId
    );

    console.log('Admin company updated', {
      companyId,
      adminUserId: admin.user_id,
      fields: keys
    });

    return response(200, {
      success: true,
      message: 'Company updated successfully.',
      company
    });

  } finally {
    await connection.end();
  }
}

// =============================================================================
// DELETE /admin/companies/{companyId}
// SOFT DELETE / DEACTIVATE COMPANY
// =============================================================================

async function handleDeleteAdminCompany(event) {
  const auth = requireAdmin(event);

  if (auth.error) return auth.error;

  const companyId = companyIdFrom(event);

  if (!companyId) {
    return response(400, {
      success: false,
      message: 'Invalid company ID.'
    });
  }

  const connection = await getDatabaseConnection();

  try {
    const admin = await getAdminProfile(
      connection,
      auth.user.cognitoSub
    );

    if (!admin) {
      return response(403, {
        success: false,
        message: 'Active administrator profile required.'
      });
    }

    const [result] = await connection.execute(
      `UPDATE companies
       SET status = 'INACTIVE'
       WHERE company_id = ?
         AND status = 'ACTIVE'`,
      [companyId]
    );

    if (!result.affectedRows) {
      const existing = await fetchCompany(
        connection,
        companyId
      );

      return existing
        ? response(409, {
            success: false,
            message: 'Company is already inactive.'
          })
        : response(404, {
            success: false,
            message: 'Company not found.'
          });
    }

    console.log('Admin company deactivated', {
      companyId,
      adminUserId: admin.user_id
    });

    return response(200, {
      success: true,
      message: 'Company deactivated successfully.',
      companyId,
      status: 'INACTIVE'
    });

  } finally {
    await connection.end();
  }
}

// =============================================================================
// EXPORTS - MATCHES index.js
// =============================================================================

module.exports = {
  handleCreateCompany: handleCreateAdminCompany,
  handleUpdateCompany: handleUpdateAdminCompany,
  handleDeleteCompany: handleDeleteAdminCompany
};
