'use strict';

const {
  getDatabaseConnection
} = require('../services/database');

const {
  response
} = require('../utils/response');


// =============================================================================
// GET /companies
// =============================================================================

async function handleGetCompanies() {

  let connection;


  try {

    connection =
      await getDatabaseConnection();


    const [rows] =
      await connection.execute(

        `
          SELECT
            company_id,
            name,
            industry,
            location,
            description,
            website

          FROM companies

          WHERE status = 'ACTIVE'

          ORDER BY name ASC
        `

      );


    const companies =
      rows.map(company => ({

        companyId:
          company.company_id,

        name:
          company.name,

        industry:
          company.industry,

        location:
          company.location,

        description:
          company.description,

        website:
          company.website

      }));


    return response(200, {

      success: true,

      count:
        companies.length,

      companies

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }

}


// =============================================================================
// GET /companies/{companyId}
// =============================================================================

async function handleGetCompany(event) {

  const rawCompanyId =
    event.pathParameters?.companyId;


  /*
   * company_id is BIGINT UNSIGNED.
   */

  if (
    !rawCompanyId ||
    !/^[1-9]\d*$/.test(rawCompanyId)
  ) {

    return response(400, {

      success: false,

      message:
        'A valid companyId is required.'

    });

  }


  let connection;


  try {

    connection =
      await getDatabaseConnection();


    const [rows] =
      await connection.execute(

        `
          SELECT
            company_id,
            name,
            industry,
            location,
            description,
            website

          FROM companies

          WHERE company_id = ?
            AND status = 'ACTIVE'

          LIMIT 1
        `,

        [rawCompanyId]

      );


    if (rows.length === 0) {

      return response(404, {

        success: false,

        message:
          'Company not found.'

      });

    }


    const company = rows[0];


    return response(200, {

      success: true,

      company: {

        companyId:
          company.company_id,

        name:
          company.name,

        industry:
          company.industry,

        location:
          company.location,

        description:
          company.description,

        website:
          company.website

      }

    });


  } finally {

    if (connection) {

      await connection.end();

    }

  }

}


module.exports = {
  handleGetCompanies,
  handleGetCompany
};
