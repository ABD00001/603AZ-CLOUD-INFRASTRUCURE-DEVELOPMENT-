'use strict';
const crypto = require('crypto');
const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_CODES = 3;
const EXPIRY_DAYS = 7;

function makeSection(n) {
  return Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}
function newCode() { return `FWP-E-${makeSection(5)}-${makeSection(5)}`; }
function codeHash(code) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}
function parseBody(event) {
  try { return event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}; }
  catch { return null; }
}
async function handleGenerateEmployerCodes(event) {
  const auth = getAuthenticatedUser(event);
  if (!auth) return response(401, { success: false, message: 'Authentication required.' });
  if (!auth.groups.includes('ADMIN')) return response(403, { success: false, message: 'Administrator access required.' });
  const companyId = Number(event.pathParameters?.companyId);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return response(400, { success: false, message: 'Invalid companyId.' });
  const body = parseBody(event);
  if (!body || Array.isArray(body)) return response(400, { success: false, message: 'Invalid JSON body.' });
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ACTIVE_CODES) {
    return response(400, { success: false, message: 'quantity must be an integer from 1 to 3.' });
  }
  let db;
  try {
    db = await getDatabaseConnection();
    await db.beginTransaction();
    const [admins] = await db.execute(
      'SELECT user_id FROM user_profiles WHERE cognito_sub = ? AND account_status = ? LIMIT 1',
      [auth.cognitoSub, 'ACTIVE']
    );
    if (!admins.length) { await db.rollback(); return response(403, { success: false, message: 'Active admin profile required. Call GET /profile first.' }); }
    // Lock the company row to serialize concurrent code generation for this company.
    const [companies] = await db.execute(
      'SELECT company_id, status FROM companies WHERE company_id = ? FOR UPDATE', [companyId]
    );
    if (!companies.length) { await db.rollback(); return response(404, { success: false, message: 'Company not found.' }); }
    if (companies[0].status !== 'ACTIVE') { await db.rollback(); return response(403, { success: false, message: 'Company is inactive.' }); }
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS active_count FROM employer_registration_codes
       WHERE company_id = ? AND status = 'UNUSED' AND expires_at > UTC_TIMESTAMP()`, [companyId]
    );
    const available = MAX_ACTIVE_CODES - Number(countRows[0].active_count);
    if (quantity > available) {
      await db.rollback();
      return response(409, { success: false, message: `Only ${available} additional active code(s) permitted.`, availableSlots: available });
    }
    const codes = [];
    for (let i = 0; i < quantity; i++) {
      let inserted = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        try {
          await db.execute(
            `INSERT INTO employer_registration_codes (company_id, code_hash, status, created_by, expires_at)
             VALUES (?, ?, 'UNUSED', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
            [companyId, codeHash(code), admins[0].user_id, EXPIRY_DAYS]
          );
          codes.push(code);
          inserted = true;
          break;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }
      if (!inserted) throw new Error('Unable to generate a unique registration code.');
    }
    await db.commit();
    return response(201, { success: true, companyId, quantity: codes.length, expiresInDays: EXPIRY_DAYS, codes, message: 'Store these codes securely; they cannot be retrieved again.' });
  } catch (err) {
    if (db) { try { await db.rollback(); } catch (_) {} }
    console.error('Employer code generation failed:', { name: err.name, code: err.code });
    return response(500, { success: false, message: 'Unable to generate employer registration codes.' });
  } finally {
    if (db) await db.end();
  }
}
module.exports = { handleGenerateEmployerCodes };
