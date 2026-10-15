'use strict';

const { getDatabaseConnection } = require('../services/database');
const { getAuthenticatedUser } = require('../services/auth');
const { response } = require('../utils/response');

// DEMO ONLY: Use a stronger privacy policy before processing real employee data.
const MIN_CONTRIBUTORS = 3;
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

  const pulseScore = round((
    (6 - Number(row.workload)) + (6 - Number(row.stress)) +
    (6 - Number(row.shiftPressure)) + Number(row.workLifeBalance)
  ) * 5);

  return { averages, pulseScore };
}

async function handleGetEmployerWellbeingAnalytics(event) {
  const user = getAuthenticatedUser(event);

  if (!user || !user.cognitoSub) {
    return response(401, {
      success: false,
      message: 'Authentication required.'
    });
  }

  if (!Array.isArray(user.groups) || !user.groups.includes('EMPLOYER')) {
    return response(403, {
      success: false,
      message: 'Employer access required.'
    });
  }

  const params = event.queryStringParameters || {};
  const rawWeeks = params.weeks;

  if (rawWeeks != null && !['1', '4', '6', '12'].includes(String(rawWeeks))) {
    return response(400, {
      success: false,
      message: 'weeks must be 1, 4, 6 or 12.'
    });
  }

  const weeks = rawWeeks == null ? 6 : Number(rawWeeks);

  const rawId = params.companyId;
  let requestedId = null;

  if (rawId != null) {
    if (!/^[1-9]\d*$/.test(String(rawId)) ||
        !Number.isSafeInteger(Number(rawId))) {
      return response(400, {
        success: false,
        message: 'Invalid companyId query parameter.'
      });
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
      WHERE u.cognito_sub = ?
        AND u.account_status = 'ACTIVE'
        AND e.status = 'ACTIVE'
        AND e.revoked_at IS NULL
      ORDER BY c.company_id
    `, [user.cognitoSub]);

    if (!companies.length) {
      return response(403, {
        success: false,
        message: 'No active company access.'
      });
    }

    let company;

    if (requestedId != null) {
      company = companies.find(
        item => Number(item.companyId) === requestedId
      );

      if (!company) {
        return response(403, {
          success: false,
          message: 'Company access denied.'
        });
      }
    } else if (companies.length === 1) {
      company = companies[0];
    } else {
      return response(400, {
        success: false,
        message: 'Specify companyId when managing multiple companies.',
        companies: companies.map(item => ({
          companyId: item.companyId,
          name: item.name
        }))
      });
    }

    // Use one database timestamp for every query and graph bucket.
    const [clockRows] = await connection.execute(
      "SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS asOf"
    );

    const asOf = clockRows[0].asOf;
    const bucketSeconds = weeks === 1 ? 86400 : 604800;
    const bucketCount = weeks === 1 ? 7 : weeks;

    // First average per employee per bucket.
    // Then average those employee values across the company.
    const [bucketRows] = await connection.execute(`
      SELECT
        employeeBucket.bucketIndex,
        SUM(employeeBucket.checkins) AS checkins,
        COUNT(*) AS contributors,
        AVG(employeeBucket.workload) AS workload,
        AVG(employeeBucket.stress) AS stress,
        AVG(employeeBucket.shiftPressure) AS shiftPressure,
        AVG(employeeBucket.workLifeBalance) AS workLifeBalance
      FROM (
        SELECT
          user_id,
          FLOOR(
            TIMESTAMPDIFF(SECOND, submitted_at, ?) / ?
          ) AS bucketIndex,
          COUNT(*) AS checkins,
          AVG(workload) AS workload,
          AVG(stress) AS stress,
          AVG(shift_pressure) AS shiftPressure,
          AVG(work_life_balance) AS workLifeBalance
        FROM wellbeing_checkins
        WHERE company_id = ?
          AND submitted_at <= ?
          AND submitted_at > DATE_SUB(?, INTERVAL ? DAY)
        GROUP BY user_id, bucketIndex
      ) AS employeeBucket
      GROUP BY employeeBucket.bucketIndex
    `, [
      asOf,
      bucketSeconds,
      company.companyId,
      asOf,
      asOf,
      weeks * 7
    ]);

    // Compare the selected reporting period with the preceding period.
    // Each employee has equal weight within each period.
    const [periodRows] = await connection.execute(`
      SELECT
        employeePeriod.period,
        SUM(employeePeriod.checkins) AS checkins,
        COUNT(*) AS contributors,
        AVG(employeePeriod.workload) AS workload,
        AVG(employeePeriod.stress) AS stress,
        AVG(employeePeriod.shiftPressure) AS shiftPressure,
        AVG(employeePeriod.workLifeBalance) AS workLifeBalance
      FROM (
        SELECT
          user_id,
          CASE
            WHEN submitted_at > DATE_SUB(?, INTERVAL ? DAY)
            THEN 'current'
            ELSE 'previous'
          END AS period,
          COUNT(*) AS checkins,
          AVG(workload) AS workload,
          AVG(stress) AS stress,
          AVG(shift_pressure) AS shiftPressure,
          AVG(work_life_balance) AS workLifeBalance
        FROM wellbeing_checkins
        WHERE company_id = ?
          AND submitted_at <= ?
          AND submitted_at > DATE_SUB(?, INTERVAL ? DAY)
        GROUP BY user_id, period
      ) AS employeePeriod
      GROUP BY employeePeriod.period
    `, [
      asOf,
      weeks * 7,
      company.companyId,
      asOf,
      asOf,
      weeks * 14
    ]);

    const current = periodRows.find(row => row.period === 'current');
    const previous = periodRows.find(row => row.period === 'previous');

    const currentSummary = summarize(current);
    const previousSummary = summarize(previous);

    const byIndex = new Map(
      bucketRows.map(row => [Number(row.bucketIndex), row])
    );

    const weeklyTrends = Array.from(
      { length: bucketCount },
      (_, index) => {
        const row = byIndex.get(bucketCount - 1 - index);
        const summary = summarize(row);

        return {
          week: index + 1,
          label: `${weeks === 1 ? 'D' : 'W'}${index + 1}`,
          sufficientData: summary !== null,
          checkins: summary ? Number(row.checkins) : null,
          contributors: summary ? Number(row.contributors) : null,
          averages: summary ? summary.averages : emptyMetrics(),
          pulseScore: summary ? summary.pulseScore : null
        };
      }
    );

    const keyIndicators = Object.fromEntries(
      METRICS.map(metric => {
        const difference = currentSummary && previousSummary
          ? round(
              currentSummary.averages[metric] -
              previousSummary.averages[metric]
            )
          : null;

        return [
          metric,
          {
            change: difference,
            direction: difference == null
              ? 'INSUFFICIENT_DATA'
              : difference > 0.1
                ? 'INCREASING'
                : difference < -0.1
                  ? 'DECREASING'
                  : 'STABLE',
            improving:
              difference == null || Math.abs(difference) <= 0.1
                ? null
                : metric === 'workLifeBalance'
                  ? difference > 0
                  : difference < 0
          }
        ];
      })
    );

    return response(200, {
      success: true,

      company: {
        companyId: company.companyId,
        name: company.name
      },

      periodWeeks: weeks,
      trendGranularity: weeks === 1 ? 'DAILY' : 'WEEKLY',

      asOfUtc: new Date(
        `${String(asOf).replace(' ', 'T')}Z`
      ).toISOString(),

      privacy: {
        minimumDistinctContributors: MIN_CONTRIBUTORS,
        suppressedPeriodsReturnNull: true,
        demoThresholdOnly: true
      },

      scoring: {
        rawScale: '1-5',
        pulseScale: '20-100',
        higherPulseIsBetter: true
      },

      participation: {
        checkins: currentSummary
          ? Number(current.checkins)
          : null,

        distinctContributors: currentSummary
          ? Number(current.contributors)
          : null,

        previousCheckins: previousSummary
          ? Number(previous.checkins)
          : null,

        checkinChangePercent:
          currentSummary &&
          previousSummary &&
          Number(previous.checkins) > 0
            ? round(
                (
                  (Number(current.checkins) -
                    Number(previous.checkins)) /
                  Number(previous.checkins)
                ) * 100
              )
            : null
      },

      averages: currentSummary
        ? currentSummary.averages
        : emptyMetrics(),

      overallPulse: currentSummary
        ? currentSummary.pulseScore
        : null,

      keyIndicators,

      weeklyTrends,

      sufficientData: currentSummary !== null
    });

  } finally {
    await connection.end();
  }
}

module.exports = {
  handleGetEmployerWellbeingAnalytics
};
