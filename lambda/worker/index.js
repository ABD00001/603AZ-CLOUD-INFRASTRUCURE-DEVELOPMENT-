'use strict';

/* FairWork Pulse - deterministic review moderation worker.
 * Uses V001 reviews/moderation_events and V002 moderation_rules.
 * CLEAN and HUMAN_APPROVED are the only publishable statuses.
 * Local dictionaries are starter policies: review and expand before production.
 */
const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const dictionaries = require('./dictionaries.json');
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
let cachedSecret;

async function connect() {
  if (!cachedSecret) {
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
    cachedSecret = JSON.parse(value.SecretString);
  }
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: cachedSecret.username,
    password: cachedSecret.password,
    charset: 'utf8mb4',
    connectTimeout: 10000
  });
}

const normalise = value => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const compare = value => normalise(value).toLocaleLowerCase('en');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function dictionaryMatch(key, content) {
  const phrases = dictionaries[key];
  if (!Array.isArray(phrases) || phrases.length === 0) {
    throw new Error(`Missing or empty moderation dictionary: ${key}`);
  }
  return phrases.some(phrase => {
    if (typeof phrase !== 'string' || !phrase.trim()) throw new Error(`Invalid dictionary entry: ${key}`);
    // Phrase matching with Unicode letter/digit boundaries, not substring matching.
    const pattern = `(?<![\\p{L}\\p{N}])${escapeRegex(compare(phrase)).replace(/\\ /g, '\\s+')}(?![\\p{L}\\p{N}])`;
    return new RegExp(pattern, 'iu').test(content);
  });
}

async function behaviouralMatch(ruleCode, connection, review, content) {
  switch (ruleCode) {
    case 'SPAM_MULTIPLE_URLS':
      return (content.match(/https?:\/\/\S+/giu) || []).length >= 2;
    case 'SPAM_MINIMAL_CONTENT':
      return compare(review.review_text).length < 30;
    case 'SPAM_DUPLICATE_REVIEW': {
      const [rows] = await connection.execute(
        `SELECT review_title, review_text FROM reviews
         WHERE user_id=? AND review_id<>? ORDER BY submitted_at DESC LIMIT 100`,
        [review.user_id, review.review_id]
      );
      return rows.some(row => compare(`${row.review_title || ''} ${row.review_text}`) === content);
    }
    case 'SPAM_SUBMISSION_VELOCITY': {
      const [[row]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM reviews
         WHERE user_id=? AND review_id<>? AND submitted_at BETWEEN DATE_SUB(?, INTERVAL 1 HOUR) AND ?`,
        [review.user_id, review.submitted_at, review.submitted_at]
      );
      return Number(row.total) >= 3;
    }
    case 'HARASSMENT_REPEATED_TARGETING': {
      // Conservative proxy: multiple recent, previously flagged harassment reviews
      // from the same account about the same company. Human review still decides.
      const [[row]] = await connection.execute(
        `SELECT COUNT(DISTINCT r.review_id) AS total FROM reviews r
         INNER JOIN moderation_events me ON me.review_id=r.review_id
         WHERE r.user_id=? AND r.company_id=? AND r.review_id<>?
           AND r.submitted_at BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
           AND me.category='HARASSMENT'`,
        [review.user_id, review.company_id, review.review_id, review.submitted_at, review.submitted_at]
      );
      return Number(row.total) >= 2;
    }
    default:
      throw new Error(`Unsupported behavioural rule: ${ruleCode}`);
  }
}

async function matches(rule, connection, review, content) {
  if (rule.pattern_type === 'REGEX') {
    if (!rule.pattern) throw new Error(`Empty regex for ${rule.rule_code}`);
    return new RegExp(rule.pattern, 'iu').test(content);
  }
  if (rule.pattern_type === 'DICTIONARY') return dictionaryMatch(rule.pattern, content);
  if (rule.pattern_type === 'BEHAVIOURAL') return behaviouralMatch(rule.rule_code, connection, review, content);
  throw new Error(`Unsupported pattern type: ${rule.pattern_type}`);
}

async function moderate(connection, reviewId) {
  await connection.beginTransaction();
  try {
    const [[review]] = await connection.execute(
      `SELECT review_id,user_id,company_id,review_title,review_text,submitted_at,moderation_status
       FROM reviews WHERE review_id=? FOR UPDATE`, [reviewId]
    );
    if (!review || review.moderation_status !== 'PENDING_ANALYSIS') {
      await connection.commit();
      console.log('Review skipped', { reviewId, status: review?.moderation_status || 'NOT_FOUND' });
      return;
    }
    const [rules] = await connection.execute(
      `SELECT rule_id,rule_code,category,pattern,pattern_type,severity,weight
       FROM moderation_rules WHERE enabled=TRUE ORDER BY rule_id`
    );
    if (!rules.length) throw new Error('No enabled moderation rules; refusing automatic publication');
    const content = compare(`${review.review_title || ''} ${review.review_text}`);
    const hits = [];
    let rawScore = 0;
    let critical = false;
    for (const rule of rules) {
      if (await matches(rule, connection, review, content)) {
        hits.push(rule);
        rawScore += Number(rule.weight);
        if (rule.severity === 'CRITICAL') critical = true;
      }
    }
    const score = Math.min(rawScore, 100);
    const flagged = critical || score >= 25;
    const status = flagged ? 'FLAGGED' : 'CLEAN';
    // A retry after a rollback never leaves duplicate events.
    await connection.execute('DELETE FROM moderation_events WHERE review_id=?', [reviewId]);
    for (const rule of hits) {
      await connection.execute(
        `INSERT INTO moderation_events
         (review_id,rule_id,rule_code,category,severity,score_contribution,evidence)
         VALUES (?,?,?,?,?,?,?)`,
        [reviewId,rule.rule_id,rule.rule_code,rule.category,rule.severity,Number(rule.weight),
          `Rule ${rule.rule_code} matched; original content not stored`]
      );
    }
    const reason = hits.length ? hits.map(hit => hit.rule_code).join(', ').slice(0, 500) : 'No configured rule matches';
    await connection.execute(
      `UPDATE reviews SET moderation_status=?,moderation_score=?,moderation_reason=?,moderated_at=UTC_TIMESTAMP()
       WHERE review_id=?`, [status,score,reason,reviewId]
    );
    await connection.commit();
    console.log('Review moderated', { reviewId, status, score, matchedRuleCodes: hits.map(hit => hit.rule_code) });
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

exports.handler = async event => {
  const failures = [];
  for (const record of event.Records || []) {
    let connection;
    try {
      const payload = JSON.parse(record.body);
      const reviewId = payload.reviewId;
      if (!Number.isSafeInteger(reviewId) || reviewId < 1) throw new Error('Invalid reviewId in SQS message');
      connection = await connect();
      await moderate(connection, reviewId);
    } catch (error) {
      console.error('Moderation worker failed', { messageId: record.messageId, error: error.message });
      failures.push({ itemIdentifier: record.messageId });
    } finally {
      if (connection) await connection.end();
    }
  }
  return { batchItemFailures: failures };
};
