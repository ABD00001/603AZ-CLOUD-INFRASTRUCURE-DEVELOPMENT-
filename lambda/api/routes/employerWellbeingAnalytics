'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

const MIN_CONTRIBUTORS = 5;
const METRICS = ['workload', 'stress', 'shiftPressure', 'workLifeBalance'];
const round = value => value == null ? null : Math.round(Number(value) * 10) / 10;
const emptyMetrics = () => Object.fromEntries(METRICS.map(metric => [metric, null]));

function summarize(row) {
  if (!row || Number(row.contributors) < MIN_CONTRIBUTORS) return null;
  const averages = {
    workload: round(row.workload),
    stress: round(row.stress),
    shiftPressure: round(row.shiftPressure),
    workLifeBalance: round(row.workLifeBalance)
  };
  // Higher workload, stress and shift pressure are less favorable;
  // higher work-life balance is more favorable. Source values are 1..5.
  const pulseScore = Math.round((
    (6 - Number(row.workload)) + (6 - Number(row.stress)) +
    (6 - Number(row.shiftPressure)) + Number(row.workLifeBalance)
  ) * 5 * 10) / 10;
  return { averages, pulseScore };
}

async function handleGetEmployerWellbeingAnalytics(event) {
  const user = getAuthenticatedUser(event);
  if (!user || !user.cognitoSub) return response(401, { success: false, message: 'Authentication required.' });
  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, { success: false, message: 'Employer access required.' });
  }

  const params = event.queryStringParameters || {};
  const rawWeeks = params.weeks;
  const weeks = rawWeeks == null ? 6 : Number(rawWeeks);
  if (![4, 6, 12].includes(weeks) || (rawWeeks != null && !['4', '6', '12'].includes(String(rawWeeks)))) {
    return response(400, { success: false, message: 'weeks must be 4, 6 or 12.' });
  }
  const rawId = params.companyId;
  let requestedId = null;
  if (rawId != null) {
    if (!/^[1-9]\d*$/.test(String(rawId)) || !Number.isSafeInteger(Number(rawId))) {
      return response(400, { success: false, message: 'Invalid companyId query parameter.' });
    }
    requestedId = Number(rawId);
  }

  const connection = await getDatabaseConnection();
  try {
    const [companies] = await connection.execute(`
      SELECT DISTINCT c.company_id AS companyId, c.name
      FROM user_profiles u
      JOIN employer_company_access e ON e.user_id = u.user_id
      JOIN companies c ON c.company_id = e.company_id
      WHERE u.cognito_sub = ? AND u.account_status = 'ACTIVE'
        AND e.status = 'ACTIVE' AND e.revoked_at IS NULL AND c.status = 'ACTIVE'
      ORDER BY c.company_id`, [user.cognitoSub]);
    if (!companies.length) return response(403, { success: false, message: 'No active company access.' });
    let company;
    if (requestedId != null) {
      company = companies.find(item => Number(item.companyId) === requestedId);
      if (!company) return response(403, { success: false, message: 'Company access denied.' });
    } else if (companies.length === 1) {
      company = companies[0];
    } else {
      return response(400, {
        success: false, message: 'Specify companyId when managing multiple companies.',
        companies: companies.map(item => ({ companyId: item.companyId, name: item.name }))
      });
    }

    // All employee-level data stays in MySQL. Only aggregates are returned.
    // weekIndex=0 is the latest rolling seven-day period; 1 is the prior seven days.
    const [weeklyRows] = await connection.execute(`
      SELECT FLOOR(TIMESTAMPDIFF(SECOND, submitted_at, UTC_TIMESTAMP()) / 604800) AS weekIndex,
             COUNT(*) AS checkins, COUNT(DISTINCT user_id) AS contributors,
             AVG(workload) AS workload, AVG(stress) AS stress,
             AVG(shift_pressure) AS shiftPressure,
             AVG(work_life_balance) AS workLifeBalance
      FROM wellbeing_checkins
      WHERE company_id = ? AND submitted_at <= UTC_TIMESTAMP()
        AND submitted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? WEEK)
      GROUP BY weekIndex`, [company.companyId, weeks]);

    const [periodRows] = await connection.execute(`
      SELECT CASE WHEN submitted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? WEEK)
                  THEN 'current' ELSE 'previous' END AS period,
             COUNT(*) AS checkins, COUNT(DISTINCT user_id) AS contributors,
             AVG(workload) AS workload, AVG(stress) AS stress,
             AVG(shift_pressure) AS shiftPressure,
             AVG(work_life_balance) AS workLifeBalance
      FROM wellbeing_checkins
      WHERE company_id = ? AND submitted_at <= UTC_TIMESTAMP()
        AND submitted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? WEEK)
      GROUP BY period`, [weeks, company.companyId, weeks * 2]);

    const current = periodRows.find(row => row.period === 'current');
    const previous = periodRows.find(row => row.period === 'previous');
    const currentSummary = summarize(current);
    const previousSummary = summarize(previous);
    const byIndex = new Map(weeklyRows.map(row => [Number(row.weekIndex), row]));
    const weeklyTrends = Array.from({ length: weeks }, (_, index) => {
      const row = byIndex.get(weeks - 1 - index);
      const summary = summarize(row);
      return {
        week: index + 1,
        label: `W${index + 1}`,
        sufficientData: summary !== null,
        // Do not disclose small-group participation counts.
        checkins: summary ? Number(row.checkins) : null,
        contributors: summary ? Number(row.contributors) : null,
        averages: summary ? summary.averages : emptyMetrics(),
        pulseScore: summary ? summary.pulseScore : null
      };
    });
    const changes = Object.fromEntries(METRICS.map(metric => {
      const difference = currentSummary && previousSummary
        ? round(currentSummary.averages[metric] - previousSummary.averages[metric]) : null;
      return [metric, {
        change: difference,
        direction: difference == null ? 'INSUFFICIENT_DATA' :
          difference > 0.1 ? 'INCREASING' : difference < -0.1 ? 'DECREASING' : 'STABLE',
        // Lower is better for the first three measures; higher for work-life balance.
        improving: difference == null || Math.abs(difference) <= 0.1 ? null :
          (metric === 'workLifeBalance' ? difference > 0 : difference < 0)
      }];
    }));

    return response(200, {
      success: true,
      company: { companyId: company.companyId, name: company.name },
      periodWeeks: weeks,
      privacy: { minimumDistinctContributors: MIN_CONTRIBUTORS, suppressedPeriodsReturnNull: true },
      scoring: { rawScale: '1-5', pulseScale: '20-100', higherPulseIsBetter: true },
      participation: {
        checkins: currentSummary ? Number(current.checkins) : null,
        distinctContributors: currentSummary ? Number(current.contributors) : null,
        previousCheckins: previousSummary ? Number(previous.checkins) : null,
        checkinChangePercent: currentSummary && previousSummary && Number(previous.checkins) > 0
          ? round((Number(current.checkins) - Number(previous.checkins)) / Number(previous.checkins) * 100) : null
      },
      averages: currentSummary ? currentSummary.averages : emptyMetrics(),
      overallPulse: currentSummary ? currentSummary.pulseScore : null,
      keyIndicators: changes,
      weeklyTrends,
      sufficientData: currentSummary !== null
    });
  } finally {
    await connection.end();
  }
}

module.exports = { handleGetEmployerWellbeingAnalytics };
