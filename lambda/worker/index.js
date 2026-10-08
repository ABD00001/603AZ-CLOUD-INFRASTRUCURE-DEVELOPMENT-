'use strict';
// Safety-first worker: REGEX policies are evaluated; unsupported dictionary/behavioural
// detectors are escalated to human review rather than silently treated as CLEAN.
const mysql = require('mysql2/promise');
const {SecretsManagerClient,GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const secrets = new SecretsManagerClient({});
let cached;
async function db() {
  if (!cached) cached = JSON.parse((await secrets.send(new GetSecretValueCommand({SecretId:process.env.DB_SECRET_ARN}))).SecretString);
  return mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),database:process.env.DB_NAME,user:cached.username,password:cached.password,charset:'utf8mb4'});
}
exports.handler = async (event) => {
  const failures = [];
  for (const record of event.Records || []) {
    let connection;
    try {
      const {reviewId} = JSON.parse(record.body);
      if (!Number.isSafeInteger(reviewId) || reviewId < 1) throw new Error('Invalid review ID');
      connection = await db();
      await connection.beginTransaction();
      const [[review]] = await connection.execute('SELECT review_id,review_title,review_text,moderation_status FROM reviews WHERE review_id=? FOR UPDATE',[reviewId]);
      if (!review || review.moderation_status !== 'PENDING_ANALYSIS') {await connection.commit();continue;}
      const [rules] = await connection.execute('SELECT rule_id,rule_code,category,pattern,pattern_type,severity,weight FROM moderation_rules WHERE enabled=TRUE');
      const content = `${review.review_title || ''} ${review.review_text}`.replace(/\s+/g,' ').trim();
      let score=0, critical=false;
      const hits=[];
      let unsupported=rules.length === 0;
      for (const rule of rules) {
        if (rule.pattern_type !== 'REGEX') {unsupported=true;continue;}
        let matched=false;
        try {matched = new RegExp(rule.pattern,'iu').test(content);} catch(error) {throw new Error(`Invalid moderation rule: ${rule.rule_code}`);}
        if (matched) {score += rule.weight; critical ||= rule.severity === 'CRITICAL';hits.push(rule);}
      }
      // Until all configured detectors are implemented, human review is mandatory.
      const finalScore=Math.min(score,100);
      const flagged=unsupported || critical || finalScore >= 25;
      for (const rule of hits) {
        await connection.execute(`INSERT INTO moderation_events (review_id,rule_id,rule_code,category,severity,score_contribution,evidence)
          VALUES (?,?,?,?,?,?,?)`,[reviewId,rule.rule_id,rule.rule_code,rule.category,rule.severity,rule.weight,`${rule.category} policy signal detected`]);
      }
      await connection.execute(`UPDATE reviews SET moderation_status=?, moderation_score=?, moderation_reason=? WHERE review_id=?`,
        [flagged?'FLAGGED':'CLEAN',finalScore,unsupported?'Human review required: moderation detectors not fully implemented':(hits.map(r=>r.rule_code).join(', ').slice(0,500)||'No policy matches'),reviewId]);
      await connection.commit();
    } catch(error) {
      console.error('Moderation worker failed',{messageId:record.messageId,error:error.message});
      if(connection) try {await connection.rollback();} catch {}
      failures.push({itemIdentifier:record.messageId});
    } finally {if(connection) await connection.end();}
  }
  return {batchItemFailures:failures};
};
