
'use strict';

/**
 * FairWork Pulse - Rule-Based Review Moderation Worker
 *
 * AWS Lambda + SQS + MySQL RDS
 *
 * Features:
 * - REGEX moderation rules
 * - DICTIONARY moderation rules
 * - BEHAVIOURAL moderation rules
 * - Weighted risk scoring
 * - Privacy-safe moderation events
 * - Automatic publication of CLEAN reviews
 * - Human review of FLAGGED reviews
 * - SQS partial batch failure handling
 *
 * Required:
 * - V001 database schema
 * - V002 moderation rules
 * - V004 regex correction
 * - dictionaries.json in the worker directory
 *
 * Environment variables:
 * - DB_HOST
 * - DB_PORT
 * - DB_NAME
 * - DB_SECRET_ARN
 */

const mysql = require('mysql2/promise');

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');

const dictionaries = require('./dictionaries.json');

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

let cachedSecret = null;

/* ============================================================
   DATABASE CONNECTION
============================================================ */

async function connect() {
  if (!cachedSecret) {
    const response = await secrets.send(
      new GetSecretValueCommand({
        SecretId: process.env.DB_SECRET_ARN
      })
    );

    cachedSecret = JSON.parse(response.SecretString);
  }

  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: cachedSecret.username,
    password: cachedSecret.password,
    charset: 'utf8mb4',
    connectTimeout: 10000,
    dateStrings: true
  });
}

/* ============================================================
   SAFE SQL EXECUTION

   Parameterised queries are used throughout.
   Query names are logged on failure without exposing SQL
   parameters, review content, or database credentials.
============================================================ */

async function runQuery(connection, operation, sql, params = []) {
  try {
    return await connection.query(sql, params);
  } catch (error) {
    console.error('Moderation SQL operation failed', {
      operation,
      code: error.code,
      errno: error.errno,
      message: error.message
    });

    throw error;
  }
}

/* ============================================================
   CONTENT NORMALISATION
============================================================ */

function normalise(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function compare(value) {
  return normalise(value).toLocaleLowerCase('en');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============================================================
   DICTIONARY MODERATION
============================================================ */

function dictionaryMatch(dictionaryKey, content) {
  const phrases = dictionaries[dictionaryKey];

  if (!Array.isArray(phrases) || phrases.length === 0) {
    throw new Error(
      `Missing or empty moderation dictionary: ${dictionaryKey}`
    );
  }

  for (const phrase of phrases) {
    if (typeof phrase !== 'string' || !phrase.trim()) {
      throw new Error(
        `Invalid dictionary entry: ${dictionaryKey}`
      );
    }

    const escapedPhrase = escapeRegex(compare(phrase))
      .replace(/\s+/g, '\\s+');

    const pattern =
      `(?<![\\p{L}\\p{N}])${escapedPhrase}(?![\\p{L}\\p{N}])`;

    const regex = new RegExp(pattern, 'iu');

    if (regex.test(content)) {
      return true;
    }
  }

  return false;
}

/* ============================================================
   BEHAVIOURAL MODERATION
============================================================ */

async function behaviouralMatch(
  ruleCode,
  connection,
  review,
  content
) {
  switch (ruleCode) {

    /* --------------------------------------------------------
       Multiple URLs
    -------------------------------------------------------- */

    case 'SPAM_MULTIPLE_URLS': {
      const urls = content.match(/https?:\/\/\S+/giu) || [];
      return urls.length >= 2;
    }

    /* --------------------------------------------------------
       Minimal content
    -------------------------------------------------------- */

    case 'SPAM_MINIMAL_CONTENT': {
      return compare(review.review_text).length < 30;
    }

    /* --------------------------------------------------------
       Duplicate review
    -------------------------------------------------------- */

    case 'SPAM_DUPLICATE_REVIEW': {
      const [rows] = await runQuery(
        connection,
        'CHECK_DUPLICATE_REVIEW',
        `
        SELECT review_title, review_text
        FROM reviews
        WHERE user_id = ?
          AND review_id <> ?
        ORDER BY submitted_at DESC
        LIMIT 100
        `,
        [
          review.user_id,
          review.review_id
        ]
      );

      return rows.some(row => {
        const previousContent = compare(
          `${row.review_title || ''} ${row.review_text || ''}`
        );

        return previousContent === content;
      });
    }

    /* --------------------------------------------------------
       Submission velocity

       Count previous submissions from the same user
       within one hour before the current review.
    -------------------------------------------------------- */

    case 'SPAM_SUBMISSION_VELOCITY': {
      const [rows] = await runQuery(
        connection,
        'CHECK_SUBMISSION_VELOCITY',
        `
        SELECT COUNT(*) AS total
        FROM reviews
        WHERE user_id = ?
          AND review_id <> ?
          AND submitted_at BETWEEN
              DATE_SUB(?, INTERVAL 1 HOUR)
              AND ?
        `,
        [
          review.user_id,
          review.review_id,
          review.submitted_at,
          review.submitted_at
        ]
      );

      return Number(rows[0]?.total || 0) >= 3;
    }

    /* --------------------------------------------------------
       Repeated harassment targeting

       Check previous harassment-related moderation events
       from the same account against the same company.
    -------------------------------------------------------- */

    case 'HARASSMENT_REPEATED_TARGETING': {
      const [rows] = await runQuery(
        connection,
        'CHECK_REPEATED_HARASSMENT',
        `
        SELECT COUNT(DISTINCT r.review_id) AS total
        FROM reviews r
        INNER JOIN moderation_events me
          ON me.review_id = r.review_id
        WHERE r.user_id = ?
          AND r.company_id = ?
          AND r.review_id <> ?
          AND r.submitted_at BETWEEN
              DATE_SUB(?, INTERVAL 30 DAY)
              AND ?
          AND me.category = 'HARASSMENT'
        `,
        [
          review.user_id,
          review.company_id,
          review.review_id,
          review.submitted_at,
          review.submitted_at
        ]
      );

      return Number(rows[0]?.total || 0) >= 2;
    }

    default:
      throw new Error(
        `Unsupported behavioural moderation rule: ${ruleCode}`
      );
  }
}

/* ============================================================
   RULE EVALUATION
============================================================ */

async function matches(
  rule,
  connection,
  review,
  content
) {
  switch (rule.pattern_type) {

    case 'REGEX': {
      if (!rule.pattern) {
        throw new Error(
          `Empty regex pattern for ${rule.rule_code}`
        );
      }

      let regex;

      try {
        regex = new RegExp(rule.pattern, 'iu');
      } catch (error) {
        throw new Error(
          `Invalid regex for ${rule.rule_code}: ${error.message}`
        );
      }

      return regex.test(content);
    }

    case 'DICTIONARY':
      return dictionaryMatch(rule.pattern, content);

    case 'BEHAVIOURAL':
      return behaviouralMatch(
        rule.rule_code,
        connection,
        review,
        content
      );

    default:
      throw new Error(
        `Unsupported moderation pattern type: ${rule.pattern_type}`
      );
  }
}

/* ============================================================
   MODERATE A SINGLE REVIEW
============================================================ */

async function moderate(connection, reviewId) {
  await connection.beginTransaction();

  try {

    /* --------------------------------------------------------
       Load review and lock it against concurrent moderation
    -------------------------------------------------------- */

    const [reviewRows] = await runQuery(
      connection,
      'LOAD_REVIEW',
      `
      SELECT
        review_id,
        user_id,
        company_id,
        review_title,
        review_text,
        submitted_at,
        moderation_status
      FROM reviews
      WHERE review_id = ?
      FOR UPDATE
      `,
      [reviewId]
    );

    const review = reviewRows[0];

    if (!review || review.moderation_status !== 'PENDING_ANALYSIS') {
      await connection.commit();

      console.log('Review skipped', {
        reviewId,
        status: review?.moderation_status || 'NOT_FOUND'
      });

      return;
    }

    /* --------------------------------------------------------
       Load enabled moderation rules
    -------------------------------------------------------- */

    const [rules] = await runQuery(
      connection,
      'LOAD_MODERATION_RULES',
      `
      SELECT
        rule_id,
        rule_code,
        category,
        pattern,
        pattern_type,
        severity,
        weight
      FROM moderation_rules
      WHERE enabled = TRUE
      ORDER BY rule_id
      `
    );

    if (!rules.length) {
      throw new Error(
        'No enabled moderation rules; automatic publication refused'
      );
    }

    const content = compare(
      `${review.review_title || ''} ${review.review_text || ''}`
    );

    const hits = [];

    let rawScore = 0;
    let critical = false;

    /* --------------------------------------------------------
       Evaluate all rules
    -------------------------------------------------------- */

    for (const rule of rules) {
      let matched;

      try {
        matched = await matches(
          rule,
          connection,
          review,
          content
        );
      } catch (error) {
        console.error('Moderation rule evaluation failed', {
          reviewId,
          ruleCode: rule.rule_code,
          patternType: rule.pattern_type,
          error: error.message
        });

        throw error;
      }

      if (matched) {
        hits.push(rule);

        rawScore += Number(rule.weight);

        if (rule.severity === 'CRITICAL') {
          critical = true;
        }
      }
    }

    /* --------------------------------------------------------
       Calculate moderation result
    -------------------------------------------------------- */

    const score = Math.min(rawScore, 100);

    const flagged = critical || score >= 25;

    const status = flagged
      ? 'FLAGGED'
      : 'CLEAN';

    /* --------------------------------------------------------
       Clear any previous moderation events

       Review remains locked during transaction.
    -------------------------------------------------------- */

    await runQuery(
      connection,
      'CLEAR_MODERATION_EVENTS',
      `
      DELETE FROM moderation_events
      WHERE review_id = ?
      `,
      [reviewId]
    );

    /* --------------------------------------------------------
       Save privacy-safe moderation events
    -------------------------------------------------------- */

    for (const rule of hits) {
      await runQuery(
        connection,
        'INSERT_MODERATION_EVENT',
        `
        INSERT INTO moderation_events
        (
          review_id,
          rule_id,
          rule_code,
          category,
          severity,
          score_contribution,
          evidence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          reviewId,
          rule.rule_id,
          rule.rule_code,
          rule.category,
          rule.severity,
          Number(rule.weight),
          `Rule ${rule.rule_code} matched; original content not stored`
        ]
      );
    }

    /* --------------------------------------------------------
       Prepare moderation reason
    -------------------------------------------------------- */

    const reason = hits.length
      ? hits.map(rule => rule.rule_code).join(', ').slice(0, 500)
      : 'No configured rule matches';

    /* --------------------------------------------------------
       Update review status
    -------------------------------------------------------- */

    await runQuery(
      connection,
      'UPDATE_REVIEW_MODERATION',
      `
      UPDATE reviews
      SET
        moderation_status = ?,
        moderation_score = ?,
        moderation_reason = ?,
        moderated_at = UTC_TIMESTAMP()
      WHERE review_id = ?
      `,
      [
        status,
        score,
        reason,
        reviewId
      ]
    );

    await connection.commit();

    console.log('Review moderated successfully', {
      reviewId,
      status,
      score,
      matchedRuleCodes: hits.map(rule => rule.rule_code)
    });

  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Moderation rollback failed', {
        reviewId,
        error: rollbackError.message
      });
    }

    throw error;
  }
}

/* ============================================================
   AWS LAMBDA SQS HANDLER
============================================================ */

exports.handler = async event => {
  const failures = [];

  for (const record of event.Records || []) {
    let connection;

    try {
      const payload = JSON.parse(record.body);

      const reviewId = payload.reviewId;

      if (!Number.isSafeInteger(reviewId) || reviewId < 1) {
        throw new Error(
          'Invalid reviewId in SQS message'
        );
      }

      console.log('Moderation started', {
        reviewId,
        messageId: record.messageId
      });

      connection = await connect();

      await moderate(connection, reviewId);

    } catch (error) {
      console.error('Moderation worker failed', {
        messageId: record.messageId,
        code: error.code,
        message: error.message
      });

      failures.push({
        itemIdentifier: record.messageId
      });

    } finally {
      if (connection) {
        try {
          await connection.end();
        } catch (error) {
          console.error('Database connection close failed', {
            message: error.message
          });
        }
      }
    }
  }

  return {
    batchItemFailures: failures
  };
};
